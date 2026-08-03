import time
from pathlib import Path
HERE=Path(__file__).parent
while not (HERE/'HARD_TRAIN_DONE.flag').exists() or 'ok hard' not in (HERE/'HARD_TRAIN_DONE.flag').read_text(encoding='utf-8',errors='replace'):
    time.sleep(30)
