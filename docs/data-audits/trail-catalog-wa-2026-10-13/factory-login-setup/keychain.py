#!/usr/bin/env python3
"""Use only the exact factory Keychain item; secrets enter through stdin."""
import ctypes as C
import hmac
import json
import sys

SERVICE = b'com.jhm.peaks.route-factory-db'
ACCOUNT = b'peaks-route-factory-worker'
sec = C.CDLL('/System/Library/Frameworks/Security.framework/Security')
cf = C.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
sec.SecKeychainFindGenericPassword.argtypes = [C.c_void_p, C.c_uint32, C.c_char_p, C.c_uint32, C.c_char_p, C.POINTER(C.c_uint32), C.POINTER(C.c_void_p), C.POINTER(C.c_void_p)]
sec.SecKeychainFindGenericPassword.restype = C.c_int32
sec.SecKeychainAddGenericPassword.argtypes = [C.c_void_p, C.c_uint32, C.c_char_p, C.c_uint32, C.c_char_p, C.c_uint32, C.c_void_p, C.POINTER(C.c_void_p)]
sec.SecKeychainAddGenericPassword.restype = C.c_int32
sec.SecKeychainItemDelete.argtypes = [C.c_void_p]
sec.SecKeychainItemDelete.restype = C.c_int32
sec.SecKeychainItemFreeContent.argtypes = [C.c_void_p, C.c_void_p]
sec.SecKeychainItemFreeContent.restype = C.c_int32
cf.CFRelease.argtypes = [C.c_void_p]

def run():
    action = sys.argv[1]
    item = C.c_void_p()
    if action == 'absent':
        # No password data requested or returned during preflight.
        status = sec.SecKeychainFindGenericPassword(None, len(SERVICE), SERVICE, len(ACCOUNT), ACCOUNT, None, None, C.byref(item))
        if item.value:
            cf.CFRelease(item)
        return {'ok': status == -25300, 'status': status}
    secret = sys.stdin.buffer.read()
    if not secret or len(secret) > 256:
        return {'ok': False, 'status': 'invalid_input'}
    if action == 'add':
        buffer = C.create_string_buffer(secret)
        status = sec.SecKeychainAddGenericPassword(None, len(SERVICE), SERVICE, len(ACCOUNT), ACCOUNT, len(secret), C.cast(buffer, C.c_void_p), C.byref(item))
        if item.value:
            cf.CFRelease(item)
        return {'ok': status == 0, 'status': status}
    if action == 'remove-own':
        length, data = C.c_uint32(), C.c_void_p()
        status = sec.SecKeychainFindGenericPassword(None, len(SERVICE), SERVICE, len(ACCOUNT), ACCOUNT, C.byref(length), C.byref(data), C.byref(item))
        if status != 0:
            return {'ok': status == -25300, 'status': status}
        try:
            if not hmac.compare_digest(C.string_at(data, length.value), secret):
                return {'ok': False, 'status': 'item_changed'}
            status = sec.SecKeychainItemDelete(item)
            return {'ok': status == 0, 'status': status}
        finally:
            sec.SecKeychainItemFreeContent(None, data)
            cf.CFRelease(item)
    return {'ok': False, 'status': 'unknown_action'}

try:
    print(json.dumps(run()))
except Exception:
    # Never print exceptions, input, password bytes, or a traceback.
    print(json.dumps({'ok': False, 'status': 'helper_failed'}))
    sys.exit(1)
