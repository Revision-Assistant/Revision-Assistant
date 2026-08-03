"""
Fine-tune Flan-T5-small for research-paper rewrite tasks on a 4GB GPU.

  python train_rewrite.py --task plag
  python train_rewrite.py --task ai
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import truststore

truststore.inject_into_ssl()

import numpy as np
import torch
from datasets import Dataset
from transformers import (
    AutoModelForSeq2SeqLM,
    AutoTokenizer,
    DataCollatorForSeq2Seq,
    Seq2SeqTrainer,
    Seq2SeqTrainingArguments,
)

HERE = Path(__file__).parent
DATA = HERE / "rewrite_data"
MODEL_NAME = "google/flan-t5-small"
MAX_SRC = 192
MAX_TGT = 192
SEED = 42

PREFIX = {
    "plag": "paraphrase scientific text: ",
    "ai": "humanize AI scientific writing: ",
    # Inputs from prepare_report_debug_data.py already include report framing.
    "report_plag": "revise similarity-flagged text: ",
    "report_ai": "revise AI-flagged text: ",
}


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def _guard_source(inp: str, task: str) -> str:
    """Strip synthetic report framing before entity-preservation checks."""
    if task.startswith("report_") and ": " in inp:
        return inp.split(": ", 1)[1]
    return inp


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--task",
        choices=["plag", "ai", "report_plag", "report_ai"],
        required=True,
    )
    ap.add_argument("--epochs", type=float, default=3.0)
    ap.add_argument("--max-train", type=int, default=10000)
    ap.add_argument("--steps", type=int, default=0, help="If >0, cap max_steps for a smoke run")
    ap.add_argument("--lr", type=float, default=1.5e-4, help="Lower LR reduces STEM token corruption")
    args = ap.parse_args()

    torch.manual_seed(SEED)
    np.random.seed(SEED)

    train = load_jsonl(DATA / f"{args.task}_train.jsonl")[: args.max_train]
    val = load_jsonl(DATA / f"{args.task}_val.jsonl")[:1000]
    if not train:
        hint = (
            "run prepare_report_debug_data.py first"
            if args.task.startswith("report_")
            else "run prepare_rewrite_data.py + filter_rewrite_data.py first"
        )
        raise SystemExit(f"No data — {hint} ({args.task})")

    from entity_guard import pair_is_trainable

    # Cap very long SciHRA abstracts so T5-small can learn; re-check entity fidelity
    def clip(rows: list[dict]) -> list[dict]:
        out = []
        for r in rows:
            inp = " ".join((r["input"] or "").split())
            tgt = " ".join((r["target"] or "").split())
            ok, _ = pair_is_trainable(_guard_source(inp, args.task), tgt, min_preserve=0.9)
            if not ok:
                continue
            out.append({"input": inp[:900], "target": tgt[:900]})
        return out

    train, val = clip(train), clip(val)
    min_rows = 50 if args.task.startswith("report_") else 100
    if len(train) < min_rows:
        raise SystemExit(
            f"After entity filter only {len(train)} train rows — prepare/filter data first"
        )
    prefix = PREFIX[args.task]
    tok = AutoTokenizer.from_pretrained(MODEL_NAME)
    # CONTINUE_FROM_BEST: chunked --steps runs accumulate on rewrite_best
    _best = HERE / "rewrite_best" / args.task
    if (_best / "model.safetensors").exists() or (_best / "pytorch_model.bin").exists():
        print(f"continuing from {_best}")
        model = AutoModelForSeq2SeqLM.from_pretrained(str(_best))
    else:
        model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME)

    def tokenize(batch):
        inputs = [prefix + t for t in batch["input"]]
        model_inputs = tok(inputs, max_length=MAX_SRC, truncation=True, padding=False)
        with tok.as_target_tokenizer():
            labels = tok(batch["target"], max_length=MAX_TGT, truncation=True, padding=False)
        # Replace pad with -100 so they are ignored in loss
        label_ids = []
        for seq in labels["input_ids"]:
            label_ids.append([(t if t != tok.pad_token_id else -100) for t in seq])
        model_inputs["labels"] = label_ids
        return model_inputs

    ds_train = Dataset.from_list(train).map(tokenize, batched=True, remove_columns=["input", "target"])
    ds_val = Dataset.from_list(val).map(tokenize, batched=True, remove_columns=["input", "target"])

    out_dir = HERE / "rewrite_out" / args.task
    best_dir = HERE / "rewrite_best" / args.task

    # Speed: larger microbatch on 4GB RTX 3050; workers=0 (Windows-safe).
    # fp16 historically NaN here — bf16 used when available.
    targs = Seq2SeqTrainingArguments(
        output_dir=str(out_dir),
        num_train_epochs=args.epochs,
        max_steps=args.steps if args.steps > 0 else -1,
        per_device_train_batch_size=4,
        per_device_eval_batch_size=8,
        gradient_accumulation_steps=4,  # effective batch 16 (unchanged)
        learning_rate=args.lr,
        warmup_ratio=0.1,
        weight_decay=0.01,
        lr_scheduler_type="cosine",
        fp16=False,  # fp16 caused NaN loss on this GPU/setup
        bf16=torch.cuda.is_available() and torch.cuda.is_bf16_supported(),
        eval_strategy="steps" if args.steps > 0 else "epoch",
        eval_steps=50 if args.steps > 0 else None,
        save_strategy="epoch",
        save_total_limit=1,
        load_best_model_at_end=args.steps <= 0,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        logging_steps=20,
        report_to="none",
        seed=SEED,
        dataloader_num_workers=0,
        dataloader_pin_memory=torch.cuda.is_available(),
        remove_unused_columns=False,
        label_smoothing_factor=0.05,
    )

    collator = DataCollatorForSeq2Seq(tok, model=model, label_pad_token_id=-100)

    trainer = Seq2SeqTrainer(
        model=model,
        args=targs,
        train_dataset=ds_train,
        eval_dataset=ds_val,
        data_collator=collator,
        tokenizer=tok,
    )

    print(f"task={args.task} train={len(ds_train)} val={len(ds_val)} cuda={torch.cuda.is_available()}")
    # Sanity: one forward loss before train
    batch = collator([ds_train[i] for i in range(min(2, len(ds_train)))])
    batch = {k: v.to(model.device) if hasattr(v, "to") else v for k, v in batch.items()}
    with torch.no_grad():
        loss0 = model(**batch).loss
    print("sanity loss before train:", float(loss0))

    t0 = time.time()
    trainer.train()
    print(f"trained in {(time.time() - t0) / 60:.1f} min")
    best_dir.mkdir(parents=True, exist_ok=True)
    trainer.save_model(str(best_dir))
    tok.save_pretrained(str(best_dir))
    (best_dir / "task.json").write_text(
        json.dumps({"task": args.task, "prefix": prefix, "base": MODEL_NAME}, indent=2),
        encoding="utf-8",
    )
    print("saved", best_dir)


if __name__ == "__main__":
    main()
