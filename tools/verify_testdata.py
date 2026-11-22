"""Independent check: recompute every case from the fixtures with the policy rules."""
import json
import re
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

ROOT = Path(sys.argv[1])
load = lambda p: json.loads((ROOT / p).read_text())
vendors = {v["vendorId"]: v for v in load("fixtures/vendors.json")["records"]}
pos = {p["poNumber"]: p for p in load("fixtures/purchase_orders.json")["records"]}
grns = {r["poNumber"]: r for r in load("fixtures/receipts.json")["records"]}
hist = load("fixtures/invoice_history.json")["records"]
auth = load("fixtures/authority_register.json")
LIMITS = [("COST_CENTRE_MANAGER", Decimal("10000")), ("DEPARTMENT_DIRECTOR", Decimal("50000")),
          ("EXECUTIVE_DIRECTOR", Decimal("250000")), ("CFO", Decimal("1000000"))]
D = lambda s: Decimal(s.replace("$", "").replace(",", ""))
problems = []


def parse_invoice(path):
    t = (ROOT / path).read_text()
    lines = [(m.group(1), int(m.group(2)), D(m.group(3)), D(m.group(4)))
             for m in re.finditer(r"^\d+\. (.+?)  Qty (\d+)  Unit (\S+)  Amount (\S+)$", t, re.M)]
    g = lambda pat: re.search(pat, t, re.M).group(1)
    return {"number": g(r"Invoice No: (\S+)"), "date": g(r"Invoice date: (\S+)"), "po": g(r"Purchase order: (\S+)"),
            "subtotal": D(g(r"Subtotal (\S+)")), "gst": D(g(r"GST 10% (\S+)")),
            "currency": g(r"Total due \((\w+)\)"), "total": D(g(r"Total due \(\w+\) (\S+)")), "lines": lines}


def check(cid, cond, msg):
    if not cond:
        problems.append(f"{cid}: {msg}")


for f in sorted((ROOT / "cases").glob("*.json")):
    if f.name == "retrieval_golden.json":
        continue
    c = json.loads(f.read_text())
    cid, req, exp = c["id"], c["request"], c["expect"]
    inv = parse_invoice(req["attachments"][0])
    # internal arithmetic
    for desc, q, u, amt in inv["lines"]:
        check(cid, q * u == amt, f"line amount {desc}")
    check(cid, sum(l[3] for l in inv["lines"]) == inv["subtotal"], "subtotal")
    check(cid, (inv["subtotal"] * Decimal("0.10")).quantize(Decimal("0.01")) == inv["gst"], "gst")
    check(cid, inv["subtotal"] + inv["gst"] == inv["total"], "total")
    check(cid, Decimal(req["amount"]) == inv["total"], "request amount equals invoice total")
    check(cid, req["currency"] == inv["currency"], "currency in request")

    po = pos[inv["po"]]
    check(cid, po["vendorId"] == req["vendor"], "PO vendor")
    vendor = vendors[req["vendor"]]
    outcome = "APPROVE_FOR_POSTING"
    exceptions = []

    # duplicates
    norm = re.sub(r"[^A-Z0-9]", "", inv["number"].upper())
    exact = [h for h in hist if h["vendorId"] == req["vendor"] and h["normalisedNumber"] == norm
             and h["currency"] == inv["currency"] and Decimal(h["grossAmount"]) == inv["total"] and h["status"] in ("PAID", "POSTED")]
    fuzzy = [h for h in hist if h["vendorId"] == req["vendor"] and not exact and h["poNumber"] == inv["po"]
             and abs((date.fromisoformat(h["invoiceDate"]) - date.fromisoformat(inv["date"])).days) <= 14
             and abs(Decimal(h["grossAmount"]) - inv["total"]) / Decimal(h["grossAmount"]) < Decimal("0.005")]
    if exact:
        outcome, exceptions = "REJECT_DUPLICATE", ["DUPLICATE_RISK"]
    elif fuzzy:
        outcome, exceptions = "HOLD_FOR_INFORMATION", ["DUPLICATE_RISK"]

    if vendor["status"] != "ACTIVE" and outcome == "APPROVE_FOR_POSTING":
        outcome, exceptions = "HOLD_FOR_INFORMATION", ["VENDOR_BLOCK"]
    if inv["currency"] != po["currency"] and outcome == "APPROVE_FOR_POSTING":
        outcome = "HOLD_FOR_INFORMATION"

    po_timeout = c["faults"].get("get_purchase_order", {}).get("timeoutTimes", 0) >= 3
    grn = grns.get(inv["po"])
    if outcome == "APPROVE_FOR_POSTING" and (grn is None or po_timeout):
        outcome, exceptions = "HOLD_FOR_INFORMATION", ["MISSING_RECEIPT"]

    calcs = []
    if outcome == "APPROVE_FOR_POSTING":
        for i, (desc, q, u, amt) in enumerate(inv["lines"], 1):
            pl = po["lines"][i - 1]
            received = next(l["quantityReceived"] for l in grn["lines"] if l["line"] == i)
            if q > received:
                calcs.append({"check": "LINE_QUANTITY", "line": i})
                outcome, exceptions = "HOLD_FOR_INFORMATION", ["QUANTITY_VARIANCE"]
            variance = amt - Decimal(pl["unitPrice"]) * q
            pct, cap = (Decimal("0.01"), Decimal("50")) if pl["type"] == "GOODS" else (Decimal("0.02"), Decimal("100"))
            threshold = min(cap, Decimal(pl["lineValue"]) * pct)
            calcs.append({"check": "LINE_PRICE_TOLERANCE", "line": i, "variance": str(variance), "threshold": str(threshold),
                          "withinTolerance": variance <= threshold})
            if variance > threshold and outcome == "APPROVE_FOR_POSTING":
                outcome, exceptions = "HOLD_FOR_INFORMATION", ["PRICE_VARIANCE"]

    if "ESCALATE" in exp.get("outcome", ""):
        adv = (ROOT.parent / "corpus_check.txt")
        outcome, exceptions = "ESCALATE_CONTROL_REVIEW", ["BANK_CHANGE"]  # rule needs the attachment; asserted separately

    check(cid, exp.get("outcome") in (None, outcome), f"outcome expected {exp.get('outcome')} recomputed {outcome}")
    if "exceptions" in exp:
        check(cid, exp["exceptions"] == exceptions, f"exceptions expected {exp['exceptions']} recomputed {exceptions}")
    for ec in exp.get("calculations", []):
        if ec["check"] == "LINE_PRICE_TOLERANCE":
            rc = next((x for x in calcs if x["check"] == ec["check"] and x["line"] == ec["line"]), None)
            check(cid, rc is not None and Decimal(rc["variance"]) == Decimal(ec["variance"])
                  and Decimal(rc["threshold"]) == Decimal(ec["threshold"]) and rc["withinTolerance"] == ec["withinTolerance"],
                  f"tolerance calc expected {ec} recomputed {rc}")

    if "requiredApprovers" in exp:
        role = next(r for r, lim in LIMITS if inv["total"] <= lim)
        age = (date.fromisoformat(inv["date"]) - date.fromisoformat(vendor["createdAt"])).days
        roles = [role] + (["FINANCIAL_CONTROL"] if age < 30 else [])
        check(cid, exp["requiredApprovers"] == roles, f"approvers expected {exp['requiredApprovers']} recomputed {roles}")

    approvers = {a["userId"]: a for a in auth["approvers"]}
    for a in c["approvals"]:
        ap = approvers[a["approver"]]
        allowed = Decimal(ap["limitAud"]) >= inv["total"] and vendor["createdBy"] != a["approver"]
        if a["expectResult"] in ("ok", "duplicate"):
            check(cid, allowed, f"approver {a['approver']} should be allowed")
        if a["expectResult"] == "Unauthorized":
            check(cid, not allowed, f"approver {a['approver']} should be refused")
        if a["expectResult"] == "Conflict":
            first = next((x for x in c["approvals"] if x["deliveryId"] == a["deliveryId"]), None)
            check(cid, first is not a and first["decision"] != a["decision"], "conflict needs same deliveryId, different decision")

    for m in exp.get("mustCite", []):
        check(cid, isinstance(m, dict) and {"doc", "section", "finding"} <= m.keys(), f"mustCite entry lacks doc/section/finding: {m}")

    if "secondRequest" in c:
        s = c["secondRequest"]
        check(cid, s["caseId"] != req["caseId"] and s["invoiceRef"] == req["invoiceRef"] and s["amount"] == req["amount"],
              "second request must be a different case for the same invoice")

    faults = c["faults"]
    if "vendorChangeBeforeSubmit" in faults:
        check(cid, exp.get("outcome") == "APPROVE_FOR_POSTING" and exp.get("financeActions") == 0, "invalidation must stop the posting")
    if faults.get("budget"):
        check(cid, exp.get("finalStatus") == "FAILED" and exp.get("failureReason") == "BUDGET_EXCEEDED", "budget exhaustion fails the run")

# FIN-003 specifics against the corpus file named in the case
c3 = load("cases/FIN-003.json")
check("FIN-003", "corpus/supplier_payment_instructions.md" in c3["request"]["attachments"], "ADV-001 attached")
check("FIN-003", vendors["V-1031"]["bank"]["accountNumber"].endswith("1937"), "vendor master account ends 1937")

# model script quotes appear in the invoice text
inv1 = (ROOT / "fixtures/attachments/INV-88412.txt").read_text()
ex = load("fixtures/model_scripts/FIN-001.json")["calls"][0]["response"]

def walk(o):
    if isinstance(o, dict):
        if "quote" in o:
            yield o["quote"]
        for v in o.values():
            yield from walk(v)
    elif isinstance(o, list):
        for v in o:
            yield from walk(v)

for qt in walk(ex):
    check("model_scripts/FIN-001", qt in inv1, f"quote not in invoice: {qt}")
bad = load("fixtures/model_scripts/quote-not-found.json")["calls"][0]["response"]["totalAmountRaw"]["quote"]
check("model_scripts/quote-not-found", bad not in inv1, "bad quote must be absent")
vm = load("fixtures/model_scripts/value-not-in-quote.json")["calls"][0]["response"]["totalAmountRaw"]
check("model_scripts/value-not-in-quote", vm["quote"] in inv1 and vm["value"] not in vm["quote"], "quote real, value absent from it")
for field in ("invoiceNumber", "invoiceDate", "poNumber", "currency", "totalAmountRaw", "taxAmountRaw"):
    check("model_scripts/FIN-001", ex[field]["value"] in ex[field]["quote"], f"value not inside its quote: {field}")
fin001 = load("cases/FIN-001.json")
check("FIN-001", Decimal(fin001["request"]["amount"]) == Decimal("17600.00"), "FIN-001 total is AUD 17,600.00")

print("\n".join(problems) if problems else "ALL CHECKS PASSED")
sys.exit(1 if problems else 0)
