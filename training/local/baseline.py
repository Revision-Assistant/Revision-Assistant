"""
Cheap baseline before spending GPU time — TF-IDF + logistic regression.
If this is close to the transformer, ship the baseline instead (200 KB vs 40+ MB).
"""
import json
from pathlib import Path

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, roc_auc_score

HERE = Path(__file__).parent


def load(name: str) -> list[dict]:
    return [json.loads(l) for l in open(HERE / f"{name}.jsonl", encoding="utf-8")]


train_rows, test_rows = load("train"), load("test")

vec = TfidfVectorizer(ngram_range=(1, 2), min_df=3, max_features=100_000, sublinear_tf=True)
Xtr = vec.fit_transform([r["text"] for r in train_rows])
Xte = vec.transform([r["text"] for r in test_rows])
ytr = [r["label"] for r in train_rows]
yte = [r["label"] for r in test_rows]

lr = LogisticRegression(max_iter=2000, C=1.0)
lr.fit(Xtr, ytr)

pred = lr.predict(Xte)
proba = lr.predict_proba(Xte)[:, 1]

print(classification_report(yte, pred, digits=3))
print("ROC-AUC:", round(roc_auc_score(yte, proba), 3))
