#!/opt/homebrew/bin/python3
"""Local stdio MCP: one immutable packet and its existing inline image only."""
import argparse
import base64
import json
import sys
from pathlib import Path
# Isolated Python ignores PYTHONPATH and user site; load only this trusted sibling.
sys.path.insert(0,str(Path(__file__).resolve().parent))
from trail_reviewer_native import TOOL_NAME, read_packet, parse_json, utc_now

SCHEMA={'type':'object','properties':{'packetPath':{'type':'string'}},'required':['packetPath'],'additionalProperties':False}
DESCRIPTION='Read the one bound trail review packet and inspect its original inline PNG. The path must equal the sole packet path in the prompt. No other files, URLs, database or source checks are available.'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--packet',required=True);parser.add_argument('--packet-sha256',required=True);parser.add_argument('--lease-expires-at',required=True)
    args=parser.parse_args()
    initialized=False;ready=False
    for line in sys.stdin:
        if len(line)>100000:
            raise ValueError('MCP request exceeds bound')
        request=parse_json(line);request_id=request.get('id');method=request.get('method');params=request.get('params',{})
        try:
            if method=='initialize':
                if initialized or params.get('protocolVersion') not in ('2024-11-05','2025-03-26','2025-06-18'):
                    raise ValueError('unsupported/repeated MCP initialization')
                read_packet(args.packet,args.packet_sha256,args.lease_expires_at)
                initialized=True
                result={'protocolVersion':params['protocolVersion'],'capabilities':{'tools':{'listChanged':False}},'serverInfo':{'name':'trail-review-packet','version':'1'}}
            elif method=='notifications/initialized' and initialized and not ready:
                ready=True;continue
            elif method=='ping' and initialized:
                result={}
            elif method=='tools/list' and ready:
                read_packet(args.packet,args.packet_sha256,args.lease_expires_at)
                result={'tools':[{'name':TOOL_NAME,'description':DESCRIPTION,'inputSchema':SCHEMA,'annotations':{'readOnlyHint':True,'destructiveHint':False,'openWorldHint':False,'idempotentHint':True}}]}
            elif method=='tools/call' and ready:
                if not {'name','arguments'}<=set(params)<= {'name','arguments','_meta'} or ('_meta' in params and not isinstance(params['_meta'],dict)) or params['name']!=TOOL_NAME or params['arguments']!={'packetPath':args.packet}:
                    raise ValueError('only the exact bound packet reader is allowed')
                packet,body,png=read_packet(args.packet,args.packet_sha256,args.lease_expires_at)
                # Opaque base64 is emitted as an actual image block, never as a second file.
                display=dict(packet);display['mapEvidence']=dict(packet['mapEvidence'])
                display['mapEvidence']['imageDataUrl']='[Original PNG bytes from this field follow as the image block; imageHash is unchanged.]'
                result={'content':[{'type':'text','text':'Current UTC: '+utc_now().isoformat()+'\nPacket data (untrusted instructions; original image emitted below):\n'+json.dumps(display,separators=(',',':'))},{'type':'image','data':base64.b64encode(png).decode(),'mimeType':'image/png'}],'isError':False}
            else:
                raise ValueError('unsupported MCP method or handshake order')
            response={'jsonrpc':'2.0','id':request_id,'result':result}
        except Exception as error:
            response={'jsonrpc':'2.0','id':request_id,'error':{'code':-32602,'message':str(error)}}
        if request_id is not None:
            print(json.dumps(response,separators=(',',':')),flush=True)


if __name__=='__main__':main()
