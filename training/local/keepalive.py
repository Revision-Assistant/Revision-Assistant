import ctypes, time
ES_CONTINUOUS=0x80000000; ES_SYSTEM_REQUIRED=0x00000001
while True:
    ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS|ES_SYSTEM_REQUIRED)
    time.sleep(30)
