#!/opt/homebrew/bin/python3
"""Pinned native reviewer launch. No database access or credential loader."""
import argparse
import base64
import datetime as dt
import hashlib
import http.server
import json
import math
import os
from pathlib import Path
import re
import selectors
import signal
import time
import stat
import struct
import subprocess
import sys
import tempfile
import threading
import tomllib
import uuid
sys.dont_write_bytecode = True

CODEX = Path('/opt/homebrew/bin/codex')
CODEX_VERSION = 'codex-cli 0.156.1'
CODEX_SHA256 = '0196e89fe5a7598f816ee54232c3d7c26d75e502ab5cfe2c9240e81d90f7255a'
PROFILE_SHA256 = '480c89cc46f62625c845b22085e01bbadf2d18ce4ece56af5aa8b72314b5b6fa'
ROOT = Path(__file__).resolve().parents[4]
PROFILE = ROOT / '.codex/agents/peaks-trail-reviewer.toml'
READER = Path(__file__).with_name('trail_reviewer_native_packet_mcp.py').resolve()
MODEL = 'gpt-6.1-sol'
TOOL_NAME = 'read_bound_trail_review_packet'
WIRE_NAMESPACE = 'mcp__trail_review_packet'
WIRE_TOOL_NAME = WIRE_NAMESPACE + '.' + TOOL_NAME
GATES = ('route_identity','geometry_rights','access','map_review','source_geometry','endpoints','statistics','self_intersection')
ATTESTATION_KEYS = {'sourceKey','routeId','inputHash','pendingHash','kind','trailheadId','objectiveId','endTrailheadId','reviewer','leaseToken','reviewPacketHash','sourceCheckHash'}
PACKET_KEYS = {'schemaVersion','sourceKey','routeId','inputHash','kind','trailheadId','objectiveId','endTrailheadId','places','candidate','sourceCheck','webEvidence','routeGeometry','mapEvidence','reviewContract','reviewResultTemplate','attestation'}
DUMMY_KEY = 'offline-trail-reviewer-dummy'
MAX_PACKET_BYTES = 10_000_000
BASE_INSTRUCTIONS_SHA256 = '3b08633fa672906666659d764864dfda1d7af5b5111ea5817c8f46e5de4e1a8d'
SKILL_METADATA_SHA256 = '2ff9efeb03fdcfb2765b790426a44131a28a9e34e3e7ea48f583cd95bbee2f82'
READONLY_POLICY_SHA256 = '29dad5ed6993c5e717376e0a1c84d54ab60ee593510916ac6cee4295e803315d'
USER_GUIDANCE_SHA256 = '812f10df60ef520c34b61727445e753f54044a1cd8b27cabbe15da8ddf7acdb5'


def fail(message):
    raise ValueError(message)


def utc_now():
    return dt.datetime.now(dt.timezone.utc)


def parse_time(value):
    if not isinstance(value,str) or not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)',value):
        fail('UTC ISO timestamp required')
    return dt.datetime.fromisoformat(value.replace('Z','+00:00'))


def fresh(value, now):
    seconds = (now - parse_time(value)).total_seconds()
    if not -300 <= seconds <= 86400:
        fail('packet evidence is stale or future dated')


def sha(body):
    return hashlib.sha256(body).hexdigest()


def unique_object(pairs):
    result = {}
    for key,value in pairs:
        if key in result:
            fail('duplicate JSON key')
        result[key] = value
    return result


def parse_json(body):
    return json.loads(body, object_pairs_hook=unique_object, parse_constant=lambda _: fail('nonfinite JSON value'))


def object_keys(value, keys, label):
    if not isinstance(value,dict) or set(value) != set(keys):
        fail(label + ' keys differ')


def safe_environment(home=False):
    # No inherited DB, cloud, alternate auth, proxy, Node/Python hooks or shell config.
    result = {'PATH':'/usr/bin:/bin:/opt/homebrew/bin','LANG':'en_US.UTF-8','TZ':'UTC'}
    if home:
        result['HOME'] = os.path.expanduser('~')
    return result


def geometry_hash(geometry):
    # Use the same ECMAScript number serialization as the existing TS digest.
    script = "const fs=require('node:fs'),crypto=require('node:crypto');const sort=x=>Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;process.stdout.write(crypto.createHash('sha256').update(JSON.stringify(sort(JSON.parse(fs.readFileSync(0,'utf8'))))).digest('hex'));"
    result = subprocess.run(['/opt/homebrew/bin/node','--input-type=commonjs','-e',script], input=json.dumps(geometry), text=True, capture_output=True, env=safe_environment(), timeout=10, check=True)
    if not re.fullmatch('[0-9a-f]{64}',result.stdout):
        fail('geometry digest unavailable')
    return result.stdout


def read_packet(packet_path, expected_hash, lease_expires_at, now=None):
    now = now or utc_now()
    path = Path(packet_path)
    if not path.is_absolute() or str(path.resolve(strict=True)) != str(path):
        fail('packet must be an absolute canonical path without symlinks')
    if not str(path).startswith('/private/tmp/') or path.is_relative_to(ROOT):
        fail('packet must be outside the checkout in /private/tmp')
    if not re.fullmatch('[0-9a-f]{64}',expected_hash):
        fail('trusted packet SHA-256 required')
    expires = parse_time(lease_expires_at)
    if not 0 < (expires-now).total_seconds() <= 905:
        fail('review lease is expired or exceeds the 15-minute bound')
    fd = os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_PACKET_BYTES or info.st_mode & 0o077:
            fail('packet must be a private bounded regular file')
        with os.fdopen(fd,'rb',closefd=False) as stream:
            body = stream.read(MAX_PACKET_BYTES+1)
    finally:
        os.close(fd)
    if len(body)>MAX_PACKET_BYTES or sha(body)!=expected_hash:
        fail('packet bytes differ from the trusted binding')
    packet = parse_json(body)
    object_keys(packet,PACKET_KEYS,'filtered packet')
    if packet['schemaVersion'] != 1:
        fail('unsupported packet schema')
    binding = packet['attestation']
    object_keys(binding,ATTESTATION_KEYS,'SQL attestation')
    for key in ('sourceKey','routeId','inputHash','kind','trailheadId','objectiveId','endTrailheadId'):
        if binding[key] != packet[key]:
            fail('packet/attestation binding differs')
    if binding['reviewer']!='peaks-route-reviewer-worker' or str(uuid.UUID(binding['leaseToken'])) != binding['leaseToken']:
        fail('reviewer lane or lease token differs')
    for key in ('inputHash','pendingHash','reviewPacketHash','sourceCheckHash'):
        if not isinstance(binding[key],str) or not re.fullmatch('[0-9a-f]{64}',binding[key]):
            fail('attestation hash missing')
    template = packet['reviewResultTemplate']
    object_keys(template,{'verdict','reviewed_at','attestation','gates','errors'},'review template')
    object_keys(template['gates'],GATES,'template gates')
    if template['attestation']!=binding or template['verdict'] is not None or template['reviewed_at'] is not None or template['errors']!=[] or any(v is not None for v in template['gates'].values()):
        fail('template is not an untouched bound review template')
    if packet['sourceCheck']['routeId']!=packet['routeId']:
        fail('source check route differs')
    fresh(packet['sourceCheck']['checkedAt'],now)
    web = packet['webEvidence']
    if not isinstance(web,list) or len(web)>12:
        fail('web evidence exceeds the packet bound')
    for item in web:
        fresh(item['checkedAt'],now)
        if item.get('untrustedContent') is not True:
            fail('public evidence must remain untrusted')
    geometry = packet['routeGeometry']
    if geometry.get('type')!='LineString' or not isinstance(geometry.get('coordinates'),list) or not 5<=len(geometry['coordinates'])<=50000:
        fail('exact route XYZ vertex bound failed')
    for p in geometry['coordinates']:
        if not isinstance(p,list) or len(p)!=3 or any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) for v in p) or abs(p[0])>180 or abs(p[1])>90 or abs(p[2])>12000:
            fail('invalid route XYZ')
    image = packet['mapEvidence']
    fresh(image['checkedAt'],now)
    if image.get('status')!='rendered' or image.get('geometryHash')!=geometry_hash(geometry):
        fail('inline map is missing or bound to different geometry')
    data_url = image.get('imageDataUrl','')
    prefix = 'data:image/png;base64,'
    if not data_url.startswith(prefix) or len(data_url)>2700000:
        fail('bounded inline PNG required')
    png = base64.b64decode(data_url[len(prefix):],validate=True)
    if sha(png)!=image.get('imageHash') or png[:8]!=b'\x89PNG\r\n\x1a\n' or len(png)<33 or png[12:16]!=b'IHDR':
        fail('inline PNG hash/header differs')
    width,height = struct.unpack('>II',png[16:24])
    if not 1<=width<=4096 or not 1<=height<=4096 or width*height>16000000:
        fail('inline PNG dimensions exceed the bound')
    return packet,body,png


def trusted_profile():
    body = PROFILE.read_bytes()
    if sha(body)!=PROFILE_SHA256:
        fail('trusted reviewer profile changed; audit the runner pin again')
    profile = tomllib.loads(body.decode())
    if profile.get('name')!='peaks_trail_reviewer' or profile.get('model')!=MODEL or profile.get('model_reasoning_effort')!='high' or profile.get('sandbox_mode')!='read-only':
        fail('trusted native profile differs')
    return profile


def validate_cli():
    if sha(CODEX.resolve(strict=True).read_bytes())!=CODEX_SHA256:
        fail('unknown Codex executable; offline audit required')
    result = subprocess.run([str(CODEX),'--version'],env=safe_environment(home=True),capture_output=True,text=True,timeout=10,check=True)
    if result.stdout.strip()!=CODEX_VERSION:
        fail('unknown Codex version')


def toml_value(value):
    if isinstance(value,dict):
        return '{'+','.join(json.dumps(k)+'='+toml_value(v) for k,v in value.items())+'}'
    return json.dumps(value,ensure_ascii=True,separators=(',',':'))


def native_config(profile, packet_path, packet_hash, lease_expiry):
    config = {'developer_instructions':profile['developer_instructions'],'model_reasoning_effort':'high','project_doc_max_bytes':0,'web_search':'disabled','shell_environment_policy.inherit':'none','agents.enabled':False,'features.skip_host_skill_discovery':True}
    disabled = ('shell_tool','unified_exec','apps','plugins','hooks','browser_use','browser_use_external','browser_use_full_cdp_access','computer_use','in_app_browser','multi_agent','code_mode_host','shell_snapshot','request_permissions_tool','view_image','goals','sleep_tool','image_generation','tool_suggest','collaboration_modes')
    for feature in disabled:
        config['features.'+feature]=False
    config['mcp_servers.trail_review_packet']={'command':sys.executable,'args':['-I','-B',str(READER),'--packet',packet_path,'--packet-sha256',packet_hash,'--lease-expires-at',lease_expiry],'enabled':True,'required':True,'enabled_tools':[TOOL_NAME],'startup_timeout_sec':10,'tool_timeout_sec':15}
    return config


def native_argv(config,cwd,packet_path):
    argv = [str(CODEX),'exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--strict-config','-s','read-only','-C',str(cwd),'-m',MODEL,'--json']
    for key,value in config.items():
        argv += ['-c',key+'='+toml_value(value)]
    return argv+[packet_path]


def request_text(item):
    content=item.get('content',[])
    if not isinstance(content,list) or any(c.get('type')!='input_text' for c in content):
        fail('unexpected initial content')
    return '\n'.join(c.get('text','') for c in content)


def validate_native_request(request, profile, packet_path):
    if request.get('model')!=MODEL or request.get('reasoning',{}).get('effort')!='high' or request.get('store') is not False:
        fail('native model/effort/fresh-session binding differs')
    if sha(request.get('instructions','').encode())!=BASE_INSTRUCTIONS_SHA256:
        fail('native core instructions changed')
    tools=request.get('tools',[])
    by_name={t.get('name'):t for t in tools}
    known_builtins={'list_mcp_resources','list_mcp_resource_templates','read_mcp_resource','request_user_input'}
    if len(tools)!=5 or set(by_name)!=known_builtins|{WIRE_NAMESPACE} or any(by_name[name].get('type')!='function' for name in known_builtins):
        fail('native tool metadata differs from the inspected allowlist')
    namespace=by_name[WIRE_NAMESPACE]
    if namespace.get('type')!='namespace' or len(namespace.get('tools',[]))!=1 or namespace['tools'][0].get('name')!=TOOL_NAME or namespace['tools'][0].get('type')!='function':
        fail('native packet namespace gained another tool')
    params=namespace['tools'][0].get('parameters')
    if params!={'type':'object','properties':{'packetPath':{'type':'string'}},'required':['packetPath'],'additionalProperties':False}:
        fail('native reader tool schema differs')
    inputs=request.get('input',[])
    if not isinstance(inputs,list) or len(inputs)!=3 or [i.get('role') for i in inputs]!=['developer','user','user']:
        fail('extra initial instructions or history')
    developer=inputs[0].get('content',[])
    if len(developer)!=3 or developer[0].get('text')!=profile['developer_instructions'] or any(c.get('type')!='input_text' for c in developer):
        fail('trusted reviewer instructions changed or gained context')
    if sha(developer[1]['text'].encode())!=SKILL_METADATA_SHA256 or sha(developer[2]['text'].encode())!=READONLY_POLICY_SHA256:
        fail('unknown ambient catalog or permission instructions')
    ambient=inputs[1].get('content',[])
    if len(ambient)!=2 or sha(ambient[0].get('text','').encode())!=USER_GUIDANCE_SHA256 or any(c.get('type')!='input_text' for c in ambient):
        fail('unknown ambient user instructions')
    environment=ambient[1].get('text','')
    if not environment.startswith('<environment_context>') or not environment.endswith('</environment_context>') or 'current_date' not in environment or '<cwd>' not in environment or len(environment)>2000:
        fail('unknown native environment metadata')
    # This is native generated environment metadata; no user instruction or route facts.
    if any(tag in environment for tag in ('<INSTRUCTIONS>','AGENTS.md','sourceKey','routeId','reviewContract')):
        fail('extra route/instruction context in native environment')
    if request_text(inputs[2])!=packet_path or len(inputs[2].get('content',[]))!=1:
        fail('reviewer prompt is not the sole packet path')
    return {'model':MODEL,'effort':'high','tools':sorted(by_name),'invocationAllowlist':[WIRE_TOOL_NAME],'profileSha256':PROFILE_SHA256,'coreInstructionsSha256':BASE_INSTRUCTIONS_SHA256,'ambientSha256':[SKILL_METADATA_SHA256,READONLY_POLICY_SHA256,USER_GUIDANCE_SHA256],'initialRoles':['developer','user','user']}


def validate_image_delivery(request, packet, packet_path, first_request):
    if request.get('model')!=MODEL or request.get('tools')!=first_request.get('tools') or request.get('instructions')!=first_request.get('instructions'):
        fail('native image request changed model, tools or trusted instructions')
    inputs=request.get('input',[])
    if inputs[:3]!=first_request.get('input') or len(inputs)>8:
        fail('native second request gained unrelated context')
    images=[];texts=[]
    def visit(value):
        if isinstance(value,dict):
            if value.get('type')=='input_image':images.append(value.get('image_url'))
            if value.get('type')=='input_text':texts.append(value.get('text',''))
            for child in value.values():visit(child)
        elif isinstance(value,list):
            for child in value:visit(child)
    visit(inputs[3:])
    if images!=[packet['mapEvidence']['imageDataUrl']] or not any(packet['attestation']['leaseToken'] in t and packet['mapEvidence']['imageHash'] in t for t in texts):
        fail('native reader did not deliver the exact bound PNG and packet text')
    return True


def synthetic_tool_response(packet_path):
    item={'type':'function_call','id':'fc_offline','call_id':'call_offline','name':TOOL_NAME,'namespace':WIRE_NAMESPACE,'arguments':json.dumps({'packetPath':packet_path})}
    response={'id':'resp_offline','object':'response','model':MODEL,'output':[]}
    return [{'type':'response.created','response':response},
            {'type':'response.output_item.added','output_index':0,'item':dict(item,arguments='')},
            {'type':'response.function_call_arguments.delta','item_id':'fc_offline','output_index':0,'delta':item['arguments']},
            {'type':'response.output_item.done','output_index':0,'item':item},
            {'type':'response.completed','response':dict(response,output=[item],usage={'input_tokens':0,'output_tokens':0,'total_tokens':0})}]

def offline_preflight(config,cwd,packet_path,profile,packet):
    captured=[]; errors=[]
    class Fixture(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            if self.headers.get('Authorization')!='Bearer '+DUMMY_KEY:
                errors.append('fixture authorization is not the dummy value')
            elif self.path!='/v1/responses':
                errors.append('unexpected fixture endpoint')
            else:
                size=int(self.headers.get('Content-Length','0'))
                if not 0<size<=MAX_PACKET_BYTES:
                    errors.append('unbounded fixture request')
                else:
                    captured.append(parse_json(self.rfile.read(size)))
                    if len(captured)==1:
                        try: validate_native_request(captured[0],profile,packet_path)
                        except ValueError as error: errors.append(str(error))
                        if not errors:
                            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
                            for event in synthetic_tool_response(packet_path):
                                self.wfile.write(('data: '+json.dumps(event)+'\n\n').encode())
                            self.wfile.flush();return
            self.send_response(400);self.send_header('Content-Type','application/json');self.end_headers()
            self.wfile.write(b'{"error":{"message":"offline preflight stops before inference","type":"invalid_request_error"}}')
        def log_message(self,*args):
            pass
    server=http.server.HTTPServer(('127.0.0.1',0),Fixture)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        offline=dict(config)
        offline['model_provider']='trail_review_offline'
        offline['model_providers.trail_review_offline']={'name':'Offline tool inspection','base_url':f'http://127.0.0.1:{server.server_port}/v1','env_key':'TRAIL_REVIEWER_OFFLINE_KEY','requires_openai_auth':False,'wire_api':'responses','request_max_retries':0,'stream_max_retries':0}
        env=safe_environment(home=True);env['TRAIL_REVIEWER_OFFLINE_KEY']=DUMMY_KEY
        result=subprocess.run(native_argv(offline,cwd,packet_path),env=env,stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=45)
    finally:
        server.shutdown();server.server_close();thread.join(timeout=2)
    if errors or len(captured)!=2 or result.returncode==0:
        fail('offline native protocol preflight failed; no live launch: '+('; '.join(errors) or 'expected two dummy requests; received '+str(len(captured))))
    proof=validate_native_request(captured[0],profile,packet_path)
    proof['inlineImageDelivered']=validate_image_delivery(captured[1],packet,packet_path,captured[0])
    return proof


def validate_result(packet,result,now=None):
    now=now or utc_now()
    object_keys(result,{'verdict','reviewed_at','attestation','gates','errors'},'review result')
    object_keys(result['gates'],GATES,'human gates')
    fresh(result['reviewed_at'],now)
    if result['attestation']!=packet['attestation'] or result['verdict'] not in ('PASS','FAIL') or any(type(v) is not bool for v in result['gates'].values()):
        fail('review result binding or gate types differ')
    errors=result['errors']
    if not isinstance(errors,list) or any(not isinstance(e,str) or not e.strip() for e in errors):
        fail('review result errors invalid')
    if result['verdict']=='PASS' and (errors or not all(result['gates'].values()) or packet['sourceCheck'].get('passed') is not True):
        fail('PASS lacks required gates')
    if result['verdict']=='FAIL' and not errors:
        fail('FAIL requires exact errors')
    return result


def validate_runtime_event(event, packet_path):
    kind=event.get('type')
    if kind in ('error','turn.failed'):
        fail('native reviewer failed')
    if kind in ('thread.started','turn.started','turn.completed'):
        return None
    if kind not in ('item.started','item.updated','item.completed'):
        fail('unknown native event; no accepted review')
    item=event.get('item',{})
    if item.get('type') in ('reasoning','agent_message'):
        return None
    if item.get('type')!='mcp_tool_call' or item.get('server')!='trail_review_packet' or item.get('tool')!=TOOL_NAME or item.get('arguments')!={'packetPath':packet_path}:
        fail('native reviewer attempted an action outside the bound packet reader')
    if item.get('status')=='failed' or item.get('error') or (isinstance(item.get('result'),dict) and item['result'].get('isError') is True):
        fail('bound packet reader failed')
    return 'reader_completed' if kind=='item.completed' and item.get('status')=='completed' else None


def run_native(argv,env,packet_path,deadline):
    # Consume and guard events while running; stop the whole owned process group on failure.
    process=subprocess.Popen(argv,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,start_new_session=True)
    events=[];reader_calls=0;buffer=b'';bytes_seen=0
    selector=selectors.DefaultSelector();selector.register(process.stdout,selectors.EVENT_READ)
    try:
        finished=False
        while not finished:
            remaining=deadline-time.monotonic()
            if remaining<=0:fail('native reviewer deadline exceeded')
            readable=selector.select(min(remaining,1))
            if not readable:continue
            chunk=os.read(process.stdout.fileno(),65536)
            if not chunk:finished=True
            else:
                buffer+=chunk;bytes_seen+=len(chunk)
                if bytes_seen>50000000 or len(buffer)>MAX_PACKET_BYTES:fail('native event output exceeds the bound')
            while b'\n' in buffer:
                line,buffer=buffer.split(b'\n',1)
                if not line.strip():continue
                event=parse_json(line)
                action=validate_runtime_event(event,packet_path)
                if action=='reader_completed':reader_calls+=1
                if len(events)>500:fail('native event count exceeds the bound')
                events.append(event)
        if buffer.strip():fail('incomplete native JSONL event')
        if process.wait(timeout=5)!=0 or reader_calls!=1:
            fail('native reviewer did not complete exactly one packet/image read')
        finals=[e['item']['text'] for e in events if e.get('type')=='item.completed' and e.get('item',{}).get('type')=='agent_message']
        if len(finals)!=1:fail('native reviewer returned no unique final JSON')
        return finals[0]
    finally:
        selector.close();process.stdout.close()
        if process.poll() is None:
            os.killpg(process.pid,signal.SIGTERM)
            try:process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid,signal.SIGKILL);process.wait(timeout=5)


def reserve(path):
    p=Path(path)
    if not p.is_absolute() or str(p.parent.resolve(strict=True))!=str(p.parent) or not str(p).startswith('/private/tmp/'):
        fail('new canonical /private/tmp output path required')
    return os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['preflight','run'])
    parser.add_argument('--packet',required=True)
    parser.add_argument('--packet-sha256',required=True)
    parser.add_argument('--lease-expires-at',required=True,help='current SQL-owned reviewer lease expiry; no database access here')
    parser.add_argument('--report',required=True)
    parser.add_argument('--output')
    parser.add_argument('--allow-model-run',action='store_true')
    args=parser.parse_args()
    if (args.command=='run' and not (args.allow_model_run and args.output)) or (args.command=='preflight' and (args.allow_model_run or args.output)):
        fail('run requires explicit --allow-model-run and a fresh output; preflight never invokes inference')
    profile=trusted_profile();validate_cli()
    packet,body,png=read_packet(args.packet,args.packet_sha256,args.lease_expires_at)
    code_hashes={'runner':sha(Path(__file__).read_bytes()),'reader':sha(READER.read_bytes())}
    report_fd=reserve(args.report); output_fd=None
    try:
        if args.output: output_fd=reserve(args.output)
        with tempfile.TemporaryDirectory(prefix='peaks-trail-review-',dir='/private/tmp') as cwd:
            config=native_config(profile,args.packet,args.packet_sha256,args.lease_expires_at)
            checks=offline_preflight(config,cwd,args.packet,profile,packet)
            report={'schemaVersion':1,'command':args.command,'packetSha256':args.packet_sha256,'leaseExpiresAt':args.lease_expires_at,'codexVersion':CODEX_VERSION,'codexSha256':CODEX_SHA256,'profileSha256':PROFILE_SHA256,'codeSha256':code_hashes,'preflight':checks,'modelRun':False,'passed':True}
            if args.command=='run':
                validate_cli();trusted_profile()
                if code_hashes!={'runner':sha(Path(__file__).read_bytes()),'reader':sha(READER.read_bytes())}:fail('reviewer code changed after offline preflight')
                read_packet(args.packet,args.packet_sha256,args.lease_expires_at)
                report['modelRun']=True
                final_text=run_native(native_argv(config,cwd,args.packet),safe_environment(home=True),args.packet,time.monotonic()+min(600,max(1,(parse_time(args.lease_expires_at)-utc_now()).total_seconds())))
                read_packet(args.packet,args.packet_sha256,args.lease_expires_at)
                result=validate_result(packet,parse_json(final_text))
                os.write(output_fd,(final_text+'\n').encode())
                report['resultSha256']=sha((final_text+'\n').encode())
            os.write(report_fd,(json.dumps(report,sort_keys=True)+'\n').encode())
    except Exception:
        os.write(report_fd,(json.dumps({'schemaVersion':1,'command':args.command,'passed':False,'modelRunAuthorized':args.allow_model_run,'error':'native review incomplete; no accepted result'})+'\n').encode())
        raise
    finally:
        os.close(report_fd)
        if output_fd is not None:os.close(output_fd)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print('trail reviewer: '+str(error),file=sys.stderr);sys.exit(1)
