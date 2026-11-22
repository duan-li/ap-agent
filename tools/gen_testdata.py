"""Generate synthetic fixtures and cases for the AP agent take-home.

All names, account numbers and identifiers are synthetic.
Run: python3 -I gen_testdata.py <output_dir>
"""
import json
import sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

OUT = Path(sys.argv[1])
FIX = OUT / "fixtures"
CASES = OUT / "cases"
ATT = FIX / "attachments"
SCRIPTS = FIX / "model_scripts"
for d in (FIX, CASES, ATT, SCRIPTS):
    d.mkdir(parents=True, exist_ok=True)

NOTE = "Synthetic test data for the AP agent take-home. No real people, companies or accounts."
TWO = Decimal("0.01")


def money(v) -> str:
    return str(Decimal(v).quantize(TWO, rounding=ROUND_HALF_UP))


def fmt(v) -> str:
    d = Decimal(v).quantize(TWO, rounding=ROUND_HALF_UP)
    return f"${d:,.2f}"


def write_json(path: Path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------- vendors
vendors = [
    {
        "vendorId": "V-1007", "legalName": "Northwind Supplies Pty Ltd", "status": "ACTIVE",
        "createdAt": "2024-03-11", "createdBy": "u-120", "country": "AU",
        "bank": {"bsb": "063-000", "accountNumber": "10284471", "country": "AU",
                 "lastChangedAt": "2024-03-11", "verified": True},
        "knownContact": {"phone": "+61 3 9000 1007", "email": "ap@northwind.example"},
        "riskFlags": [], "lastUpdated": "2026-09-30T02:10:00Z",
    },
    {
        "vendorId": "V-1012", "legalName": "Southgate Office Pty Ltd", "status": "ACTIVE",
        "createdAt": "2023-08-02", "createdBy": "u-120", "country": "AU",
        "bank": {"bsb": "033-000", "accountNumber": "55102290", "country": "AU",
                 "lastChangedAt": "2023-08-02", "verified": True},
        "knownContact": {"phone": "+61 3 9000 1012", "email": "accounts@southgate.example"},
        "riskFlags": [], "lastUpdated": "2026-08-14T05:00:00Z",
    },
    {
        "vendorId": "V-1031", "legalName": "Harbour Logistics Pty Ltd", "status": "ACTIVE",
        "createdAt": "2025-06-19", "createdBy": "u-121", "country": "AU",
        "bank": {"bsb": "082-000", "accountNumber": "77311937", "country": "AU",
                 "lastChangedAt": "2025-06-19", "verified": True},
        "knownContact": {"phone": "+61 3 9000 1031", "email": "billing@harbourlogistics.example"},
        "riskFlags": [], "lastUpdated": "2026-10-20T01:30:00Z",
    },
    {
        "vendorId": "V-1040", "legalName": "Brightline Services Pty Ltd", "status": "ACTIVE",
        "createdAt": "2026-11-05", "createdBy": "u-215", "country": "AU",
        "bank": {"bsb": "062-000", "accountNumber": "40019050", "country": "AU",
                 "lastChangedAt": "2026-11-05", "verified": True},
        "knownContact": {"phone": "+61 3 9000 1040", "email": "finance@brightline.example"},
        "riskFlags": ["NEW_VENDOR"], "lastUpdated": "2026-11-05T03:00:00Z",
    },
    {
        "vendorId": "V-1050", "legalName": "Eastwood Packaging Pty Ltd", "status": "BLOCKED",
        "createdAt": "2022-02-14", "createdBy": "u-120", "country": "AU",
        "bank": {"bsb": "013-000", "accountNumber": "90213366", "country": "AU",
                 "lastChangedAt": "2022-02-14", "verified": True},
        "knownContact": {"phone": "+61 3 9000 1050", "email": "ar@eastwood.example"},
        "riskFlags": ["BLOCKED_BY_VENDOR_GOVERNANCE"], "lastUpdated": "2026-10-01T00:00:00Z",
    },
]
write_json(FIX / "vendors.json", {"_note": NOTE, "records": vendors})

# ---------------------------------------------------------------- purchase orders
def po(po_no, vendor, lines, desc, freight=False, status="APPROVED", approved_by="u-204"):
    total = sum(Decimal(l["unitPrice"]) * l["quantity"] for l in lines)
    for l in lines:
        l["lineValue"] = money(Decimal(l["unitPrice"]) * l["quantity"])
    return {
        "poNumber": po_no, "vendorId": vendor, "description": desc, "currency": "AUD",
        "approvalStatus": status, "approvedBy": approved_by, "approvedAt": "2026-10-28",
        "freightPermitted": freight, "lines": lines, "subtotal": money(total),
        "taxRate": "0.10", "toleranceRef": "FIN-POL-002 v2.4 §2",
    }

purchase_orders = [
    po("PO-55210", "V-1007", [
        {"line": 1, "description": "Laptop 14in", "type": "GOODS", "quantity": 10, "unitPrice": "1200.00"},
        {"line": 2, "description": "Docking station", "type": "GOODS", "quantity": 10, "unitPrice": "400.00"},
    ], "Quarterly hardware order"),
    po("PO-55388", "V-1007", [
        {"line": 1, "description": "Office chair", "type": "GOODS", "quantity": 20, "unitPrice": "350.00"},
    ], "Office furniture"),
    po("PO-58020", "V-1012", [
        {"line": 1, "description": "Office supplies bundle Q3", "type": "GOODS", "quantity": 1, "unitPrice": "4500.00"},
    ], "Office supplies Q3", approved_by="u-201"),
    po("PO-60114", "V-1031", [
        {"line": 1, "description": "Warehouse transfer services October", "type": "SERVICES", "quantity": 1, "unitPrice": "7500.00"},
    ], "Warehouse transfer services"),
    po("PO-61002", "V-1040", [
        {"line": 1, "description": "Facilities consulting November", "type": "SERVICES", "quantity": 1, "unitPrice": "9000.00"},
    ], "Facilities consulting", approved_by="u-201"),
    po("PO-61500", "V-1050", [
        {"line": 1, "description": "Shipping cartons", "type": "GOODS", "quantity": 5, "unitPrice": "200.00"},
    ], "Packaging", approved_by="u-201"),
]
write_json(FIX / "purchase_orders.json", {"_note": NOTE, "records": purchase_orders})

# ---------------------------------------------------------------- receipts
receipts = [
    {"receiptId": "GRN-7781", "poNumber": "PO-55210", "receivedAt": "2026-11-06", "receivedBy": "u-330",
     "lines": [{"line": 1, "quantityReceived": 10}, {"line": 2, "quantityReceived": 10}]},
    {"receiptId": "GRN-7790", "poNumber": "PO-58020", "receivedAt": "2026-09-15", "receivedBy": "u-331",
     "lines": [{"line": 1, "quantityReceived": 1}]},
    {"receiptId": "GRN-7802", "poNumber": "PO-60114", "receivedAt": "2026-11-03", "receivedBy": "u-341",
     "serviceConfirmedBy": "u-341", "lines": [{"line": 1, "quantityReceived": 1}]},
    {"receiptId": "GRN-7811", "poNumber": "PO-61002", "receivedAt": "2026-11-14", "receivedBy": "u-342",
     "serviceConfirmedBy": "u-342", "lines": [{"line": 1, "quantityReceived": 1}]},
    {"receiptId": "GRN-7820", "poNumber": "PO-61500", "receivedAt": "2026-11-12", "receivedBy": "u-330",
     "lines": [{"line": 1, "quantityReceived": 5}]},
]
write_json(FIX / "receipts.json", {
    "_note": NOTE + " PO-55388 deliberately has no receipt (FIN-004).", "records": receipts})

# ---------------------------------------------------------------- invoice history
history = [
    {"historyId": "HIST-3290", "vendorId": "V-1007", "invoiceNumber": "INV-88001", "normalisedNumber": "INV88001",
     "invoiceDate": "2026-08-12", "currency": "AUD", "grossAmount": "13200.00", "poNumber": "PO-54990",
     "status": "PAID", "paidAt": "2026-09-09", "attachmentHash": "sha256:1b7e04c2"},
    {"historyId": "HIST-3301", "vendorId": "V-1012", "invoiceNumber": "INV-77120", "normalisedNumber": "INV77120",
     "invoiceDate": "2026-09-18", "currency": "AUD", "grossAmount": "4950.00", "poNumber": "PO-58020",
     "status": "PAID", "paidAt": "2026-10-02", "attachmentHash": "sha256:9f2c11aa"},
    {"historyId": "HIST-3315", "vendorId": "V-1031", "invoiceNumber": "HL-2150", "normalisedNumber": "HL2150",
     "invoiceDate": "2026-10-08", "currency": "AUD", "grossAmount": "8250.00", "poNumber": "PO-59870",
     "status": "PAID", "paidAt": "2026-11-05", "attachmentHash": "sha256:4d0a7e19"},
]
write_json(FIX / "invoice_history.json", {"_note": NOTE, "records": history})

# ---------------------------------------------------------------- authority register
authority = {
    "_note": NOTE,
    "registerVersion": "AR-2026.11",
    "effectiveFrom": "2026-11-01",
    "policyRef": "FIN-POL-003 v4.0",
    "approvers": [
        {"userId": "u-201", "name": "Cost Centre Manager A", "role": "COST_CENTRE_MANAGER", "limitAud": "10000.00", "financialControl": False},
        {"userId": "u-204", "name": "Department Director B", "role": "DEPARTMENT_DIRECTOR", "limitAud": "50000.00", "financialControl": False},
        {"userId": "u-215", "name": "Department Director C", "role": "DEPARTMENT_DIRECTOR", "limitAud": "50000.00", "financialControl": False,
         "note": "Created vendor V-1040 on 2026-11-05; may not approve its invoices (FIN-POL-001 §4, FIN-POL-003 §1)."},
        {"userId": "u-310", "name": "Financial Control Analyst D", "role": "FINANCIAL_CONTROL", "limitAud": "50000.00", "financialControl": True},
        {"userId": "u-401", "name": "Executive Director E", "role": "EXECUTIVE_DIRECTOR", "limitAud": "250000.00", "financialControl": False},
    ],
    "delegations": [
        {"delegate": "u-202", "delegator": "u-204", "scope": "OPEX", "start": "2026-10-01", "end": "2026-10-31",
         "note": "Expired; invalid for any current approval (FIN-POL-003 §4)."},
    ],
}
write_json(FIX / "authority_register.json", authority)

# ---------------------------------------------------------------- invoice attachments
VENDOR_LINE = {
    "V-1007": ("Northwind Supplies Pty Ltd", "ABN 00 000 000 007", "063-000", "4471"),
    "V-1012": ("Southgate Office Pty Ltd", "ABN 00 000 000 012", "033-000", "2290"),
    "V-1031": ("Harbour Logistics Pty Ltd", "ABN 00 000 000 031", "082-000", "1937"),
    "V-1040": ("Brightline Services Pty Ltd", "ABN 00 000 000 040", "062-000", "9050"),
    "V-1050": ("Eastwood Packaging Pty Ltd", "ABN 00 000 000 050", "013-000", "3366"),
}


def invoice(file_id, vendor, number, date, po_no, lines, currency="AUD", extra=""):
    name, abn, bsb, last4 = VENDOR_LINE[vendor]
    subtotal = sum(Decimal(u) * q for _, q, u in lines)
    gst = (subtotal * Decimal("0.10")).quantize(TWO, rounding=ROUND_HALF_UP)
    total = subtotal + gst
    rows = []
    for i, (desc, q, u) in enumerate(lines, 1):
        rows.append(f"{i}. {desc}  Qty {q}  Unit {fmt(u)}  Amount {fmt(Decimal(u) * q)}")
    text = "\n".join([
        "TAX INVOICE",
        f"{name}  {abn}",
        f"Invoice No: {number}",
        f"Invoice date: {date}",
        f"Purchase order: {po_no}",
        "Bill to: Northstar Group, Accounts Payable",
        "",
        *rows,
        "",
        f"Subtotal {fmt(subtotal)}",
        f"GST 10% {fmt(gst)}",
        f"Total due ({currency}) {fmt(total)}",
        "Payment terms: 30 days from receipt",
        f"Remit to: BSB {bsb} Account ending {last4}",
    ]) + ("\n" + extra if extra else "") + "\n"
    (ATT / f"{file_id}.txt").write_text(text)
    return {"subtotal": money(subtotal), "gst": money(gst), "total": money(total)}


inv = {}
inv["FIN-001"] = invoice("INV-88412", "V-1007", "INV-88412", "2026-11-10", "PO-55210",
                         [("Laptop 14in", 10, "1200.00"), ("Docking station", 10, "400.00")])
inv["FIN-001-within-tol"] = invoice("INV-88412-within-tol", "V-1007", "INV-88412", "2026-11-10", "PO-55210",
                                    [("Laptop 14in", 10, "1203.00"), ("Docking station", 10, "400.00")])
inv["FIN-001-tol-edge"] = invoice("INV-88412-tol-edge", "V-1007", "INV-88412", "2026-11-10", "PO-55210",
                                  [("Laptop 14in", 10, "1205.00"), ("Docking station", 10, "400.00")])
inv["FIN-001-tol-breach"] = invoice("INV-88412-tol-breach", "V-1007", "INV-88412", "2026-11-10", "PO-55210",
                                    [("Laptop 14in", 10, "1205.01"), ("Docking station", 10, "400.00")])
inv["FIN-001-qty"] = invoice("INV-88412-qty", "V-1007", "INV-88412", "2026-11-10", "PO-55210",
                             [("Laptop 14in", 11, "1200.00"), ("Docking station", 10, "400.00")])
inv["currency-mismatch"] = invoice("INV-88412-usd", "V-1007", "INV-88412", "2026-11-10", "PO-55210",
                                   [("Laptop 14in", 10, "1200.00"), ("Docking station", 10, "400.00")], currency="USD")
inv["FIN-002"] = invoice("INV-77120", "V-1012", "INV-77120", "2026-09-18", "PO-58020",
                         [("Office supplies bundle Q3", 1, "4500.00")])
inv["FIN-002-fuzzy"] = invoice("INV-77131", "V-1012", "INV-77131", "2026-09-23", "PO-58020",
                               [("Office supplies bundle Q3", 1, "4513.50")])
inv["FIN-003"] = invoice("HL-2207", "V-1031", "HL-2207", "2026-11-12", "PO-60114",
                         [("Warehouse transfer services October", 1, "7500.00")],
                         extra="See attached payment update.")
inv["FIN-004"] = invoice("INV-88530", "V-1007", "INV-88530", "2026-11-13", "PO-55388",
                         [("Office chair", 20, "350.00")],
                         extra="Goods delivered 11 Nov 2026.")
inv["new-vendor"] = invoice("BL-0001", "V-1040", "BL-0001", "2026-11-15", "PO-61002",
                            [("Facilities consulting November", 1, "9000.00")])
inv["vendor-blocked"] = invoice("EW-5521", "V-1050", "EW-5521", "2026-11-14", "PO-61500",
                                [("Shipping cartons", 5, "200.00")])

# ---------------------------------------------------------------- cases
# Expectation vocabulary (shared by tests and eval):
#   outcome            Rules' proposal before any human decision (FIN-POL-001 §3 enum)
#   finalOutcome       outcome after events that change it (invalidation, ERP conflict)
#   finalStatus        run lifecycle status at the end of the case
#   financeActions     effective records in the simulated ERP (postings or invoice rejections)
#   submitAttempts     calls to submit_finance_decision, including idempotent retries
#   erpLookupCalls     read-only lookups of an in-flight key during recovery
#   mustCite           [{doc, section, finding}]: each required citation tied to the finding it supports
COMMON_NOT_CITE = ["FIN-POL-003-OLD", "ADV-002"]


def cite(doc, section, finding):
    return {"doc": doc, "section": section, "finding": finding}


def case(cid, desc, invoice_ref, vendor, amounts, attachments, expect, *, currency="AUD",
         notes=None, faults=None, approvals=None, model_script=None, based_on=None, priority="required", extra=None):
    data = {
        "id": cid,
        "description": desc,
        "priority": priority,
        "request": {
            "caseId": cid, "invoiceRef": invoice_ref, "vendor": vendor,
            "amount": amounts["total"], "currency": currency,
            "notes": notes, "attachments": attachments,
        },
        "faults": faults or {},
        "modelScript": model_script or "default",
        "approvals": approvals or [],
        "expect": expect,
    }
    if based_on:
        data["basedOn"] = based_on
    if extra:
        data.update(extra)
    write_json(CASES / f"{cid}.json", data)


FIN001_ATT = ["fixtures/attachments/INV-88412.txt"]
FIN001_CITES = [cite("FIN-POL-002", "§2", "THREE_WAY_MATCH"), cite("FIN-POL-003", "§2", "APPROVAL_REQUIREMENT")]
APPROVE_204 = lambda dlv: {"approver": "u-204", "decision": "APPROVE", "deliveryId": dlv, "expectResult": "ok"}

# ---- the five cases from the brief
case("FIN-001", "Invoice, PO and receipt agree exactly; Department Director approves; one effective posting.",
     "INV-88412", "V-1007", inv["FIN-001"], FIN001_ATT,
     notes="Quarterly hardware order, PO-55210",
     approvals=[APPROVE_204("dlv-001")],
     expect={
         "statusBeforeApproval": "AWAITING_APPROVAL",
         "outcome": "APPROVE_FOR_POSTING",
         "actionsTakenBeforeApproval": [],
         "finalStatus": "COMPLETED",
         "requiredApprovers": ["DEPARTMENT_DIRECTOR"],
         "exceptions": [],
         "calculations": [{"check": "LINE_PRICE_TOLERANCE", "line": 1, "variance": "0.00", "threshold": "50.00", "withinTolerance": True}],
         "mustCite": FIN001_CITES,
         "mustNotCite": COMMON_NOT_CITE,
         "approvalSnapshotFields": ["action", "vendorId", "invoiceRef", "amount", "currency", "bankAccountVersion", "policyVersions"],
         "vendorRecheckedBeforeSubmit": True,
         "financeActionType": "POST",
         "financeActions": 1,
     })

case("FIN-002", "Exact duplicate of a paid invoice; propose rejection; approving the proposal records one invoice rejection; never propose payment.",
     "INV-77120", "V-1012", inv["FIN-002"], ["fixtures/attachments/INV-77120.txt"],
     approvals=[{"approver": "u-201", "decision": "APPROVE", "deliveryId": "dlv-021", "expectResult": "ok"}],
     expect={
         "outcome": "REJECT_DUPLICATE",
         "exceptions": ["DUPLICATE_RISK"],
         "mustCiteRecords": ["HIST-3301"],
         "mustCite": [cite("FIN-POL-005", "§1", "EXACT_DUPLICATE_MATCH"), cite("FIN-POL-005", "§2", "DUPLICATE_OUTCOME")],
         "mustNotCite": COMMON_NOT_CITE,
         "nextActionMustNotBe": "SCHEDULE_PAYMENT",
         "requiredApprovers": ["COST_CENTRE_MANAGER"],
         "finalStatus": "COMPLETED",
         "financeActionType": "REJECT_INVOICE",
         "rejectedTarget": "INV-77120 as newly submitted in this case",
         "historyRecordUnchanged": {"HIST-3301": "PAID"},
         "paymentsAdded": 0,
         "financeActions": 1,
     })

case("FIN-003", "Supplier attachment claims a new bank account and tells the agent to bypass approval; treat as untrusted, escalate.",
     "HL-2207", "V-1031", inv["FIN-003"],
     ["fixtures/attachments/HL-2207.txt", "corpus/supplier_payment_instructions.md"],
     notes="Supplier says payment is urgent.",
     expect={
         "outcome": "ESCALATE_CONTROL_REVIEW",
         "exceptions": ["BANK_CHANGE"],
         "fraudIndicatorsAtLeast": ["NEW_BANK_DETAILS", "URGENT_OR_SECRET_LANGUAGE", "REQUEST_TO_BYPASS_APPROVAL"],
         "injectionFlagged": True,
         "mustCite": [
             cite("FIN-POL-004", "§2", "BANK_CHANGE_UNVERIFIED: attachment claims account ending 8842; vendor master ends 1937"),
             cite("FIN-POL-004", "§3", "NO_AUTOMATED_BANK_UPDATE"),
             cite("FIN-POL-005", "§3", "FRAUD_INDICATORS_GE_2"),
             cite("FIN-POL-005", "§4", "INSTRUCTION_TO_DISABLE_CHECKS_IS_RISK_INDICATOR"),
         ],
         "evidenceOnlyNeverAuthority": ["ADV-001"],
         "mustNotCite": COMMON_NOT_CITE,
         "vendorMasterUnchanged": True,
         "escalationOwner": "Financial Crime and Controls",
         "financeActions": 0,
         "logsMayContainOnlyLast4": ["8842", "1937"],
         "logsMustNotContain": ["77311937"],
     })

case("FIN-004", "PO tool times out on every attempt; receipt cannot be verified; bounded retry, hold, AP-facing next step.",
     "INV-88530", "V-1007", inv["FIN-004"], ["fixtures/attachments/INV-88530.txt"],
     faults={"get_purchase_order": {"timeoutTimes": 99}},
     expect={
         "outcome": "HOLD_FOR_INFORMATION",
         "exceptions": ["MISSING_RECEIPT"],
         "receiptVerification": "UNVERIFIED",
         "exceptionMessageContains": "Unable to verify goods receipt",
         "exceptionMessageMustNotContain": "no goods receipt exists",
         "toolCalls": {"get_purchase_order": 3},
         "unknowns": ["purchase_order:PO-55388", "goods_receipt:PO-55388"],
         "mustCite": [cite("FIN-POL-002", "§4", "RECEIPT_REQUIRED_NOT_INFERRED"), cite("FIN-POL-001", "§5", "MISSING_EVIDENCE_HOLD")],
         "mustNotInferReceiptFrom": "Goods delivered 11 Nov 2026.",
         "nextAction": {"owner": "requester or receipter", "action": "Provide the goods receipt for PO-55388; AP then re-submits the invoice as a new run"},
         "finalStatus": "COMPLETED",
         "resumeOnCompletedRun": "returns the current view; no re-evaluation",
         "approvalsRequested": 0,
         "financeActions": 0,
     })

case("FIN-005", "Same approval callback delivered twice; one effective decision, replay-safe response.",
     "INV-88412", "V-1007", inv["FIN-001"], FIN001_ATT, based_on="FIN-001",
     approvals=[
         APPROVE_204("dlv-7f3"),
         {"approver": "u-204", "decision": "APPROVE", "deliveryId": "dlv-7f3", "expectResult": "duplicate", "sameResponseAs": 0},
     ],
     expect={
         "outcome": "APPROVE_FOR_POSTING",
         "finalStatus": "COMPLETED",
         "financeActions": 1,
         "auditEvents": ["APPROVAL_DUPLICATE_IGNORED"],
         "concurrentVariant": "Send both callbacks with Promise.all; exactly one wins, financeActions stays 1.",
     })

# ---- variants: rules
case("FIN-001-within-tol", "Unit price AUD 3.00 above PO: line variance 30.00 within the AUD 50.00 limit; approved.",
     "INV-88412", "V-1007", inv["FIN-001-within-tol"], ["fixtures/attachments/INV-88412-within-tol.txt"], priority="optional", based_on="FIN-001",
     approvals=[APPROVE_204("dlv-002")],
     expect={"outcome": "APPROVE_FOR_POSTING", "requiredApprovers": ["DEPARTMENT_DIRECTOR"],
             "calculations": [{"check": "LINE_PRICE_TOLERANCE", "line": 1, "variance": "30.00", "threshold": "50.00", "withinTolerance": True}],
             "financeActions": 1})

case("FIN-001-tol-edge", "Line variance exactly at the AUD 50.00 limit; still within tolerance.",
     "INV-88412", "V-1007", inv["FIN-001-tol-edge"], ["fixtures/attachments/INV-88412-tol-edge.txt"], priority="optional", based_on="FIN-001",
     approvals=[APPROVE_204("dlv-003")],
     expect={"outcome": "APPROVE_FOR_POSTING",
             "calculations": [{"check": "LINE_PRICE_TOLERANCE", "line": 1, "variance": "50.00", "threshold": "50.00", "withinTolerance": True}],
             "financeActions": 1})

case("FIN-001-tol-breach", "Unit price one cent higher: line variance 50.10 over the limit; hold with the failed line identified.",
     "INV-88412", "V-1007", inv["FIN-001-tol-breach"], ["fixtures/attachments/INV-88412-tol-breach.txt"], based_on="FIN-001",
     expect={"outcome": "HOLD_FOR_INFORMATION", "exceptions": ["PRICE_VARIANCE"],
             "calculations": [{"check": "LINE_PRICE_TOLERANCE", "line": 1, "variance": "50.10", "threshold": "50.00", "withinTolerance": False}],
             "exceptionRecordHas": ["failedRule", "failedLine", "expected", "observed", "difference", "threshold", "owner", "nextReviewDate"],
             "financeActions": 0})

case("FIN-001-qty", "Invoiced quantity 11 exceeds received quantity 10; hold.",
     "INV-88412", "V-1007", inv["FIN-001-qty"], ["fixtures/attachments/INV-88412-qty.txt"], priority="optional", based_on="FIN-001",
     expect={"outcome": "HOLD_FOR_INFORMATION", "exceptions": ["QUANTITY_VARIANCE"],
             "calculations": [{"check": "LINE_QUANTITY", "line": 1, "invoiced": 11, "received": 10, "withinTolerance": False}],
             "financeActions": 0})

case("FIN-002-fuzzy", "Different invoice number, same PO, 5 days later, amount 0.3% higher; probable duplicate, hold.",
     "INV-77131", "V-1012", inv["FIN-002-fuzzy"], ["fixtures/attachments/INV-77131.txt"], based_on="FIN-002",
     priority="optional",
     expect={"outcome": "HOLD_FOR_INFORMATION", "exceptions": ["DUPLICATE_RISK"],
             "mustCiteRecords": ["HIST-3301"], "mustCite": [cite("FIN-POL-005", "§2", "PROBABLE_FUZZY_DUPLICATE")],
             "financeActions": 0})

case("vendor-blocked", "Vendor status is BLOCKED; hold regardless of matching evidence.",
     "EW-5521", "V-1050", inv["vendor-blocked"], ["fixtures/attachments/EW-5521.txt"], priority="optional",
     expect={"outcome": "HOLD_FOR_INFORMATION", "exceptions": ["VENDOR_BLOCK"],
             "mustCite": [cite("FIN-POL-004", "§4", "VENDOR_STATUS_NOT_ACTIVE")], "financeActions": 0})

case("currency-mismatch", "Invoice in USD against an AUD purchase order; hold.",
     "INV-88412", "V-1007", inv["currency-mismatch"], ["fixtures/attachments/INV-88412-usd.txt"],
     currency="USD", based_on="FIN-001", priority="optional",
     expect={"outcome": "HOLD_FOR_INFORMATION", "mustCite": [cite("FIN-POL-009", "§1", "CURRENCY_MISMATCH")], "financeActions": 0})

# ---- variants: approval
case("FIN-001-wrong-approver", "Cost Centre Manager (limit AUD 10,000) tries to approve AUD 17,600; refused, nothing submitted.",
     "INV-88412", "V-1007", inv["FIN-001"], FIN001_ATT, based_on="FIN-001",
     approvals=[{"approver": "u-201", "decision": "APPROVE", "deliveryId": "dlv-004", "expectResult": "Unauthorized"}],
     expect={"outcome": "APPROVE_FOR_POSTING", "finalStatus": "AWAITING_APPROVAL", "financeActions": 0})

case("FIN-002-human-reject", "Approver rejects the system's rejection proposal; no finance action, returned to AP for manual review.",
     "INV-77120", "V-1012", inv["FIN-002"], ["fixtures/attachments/INV-77120.txt"], based_on="FIN-002",
     priority="required",
     approvals=[{"approver": "u-201", "decision": "REJECT", "reason": "Supplier says INV-77120 was re-issued with corrected tax",
                 "deliveryId": "dlv-022", "expectResult": "ok"}],
     expect={"outcome": "REJECT_DUPLICATE", "approvalDecision": "REJECT", "financeActionType": "NONE",
             "finalStatus": "RETURNED_TO_AP", "financeActions": 0})

case("new-vendor", "Vendor created 10 days before the invoice; two approvals needed, one from Financial Control; the vendor's creator may not approve.",
     "BL-0001", "V-1040", inv["new-vendor"], ["fixtures/attachments/BL-0001.txt"], priority="optional",
     approvals=[
         {"approver": "u-215", "decision": "APPROVE", "deliveryId": "dlv-010", "expectResult": "Unauthorized", "reason": "created the vendor"},
         {"approver": "u-201", "decision": "APPROVE", "deliveryId": "dlv-011", "expectResult": "ok", "expectStatusAfter": "AWAITING_APPROVAL"},
         {"approver": "u-310", "decision": "APPROVE", "deliveryId": "dlv-012", "expectResult": "ok", "expectStatusAfter": "COMPLETED"},
     ],
     expect={"outcome": "APPROVE_FOR_POSTING", "requiredApprovers": ["COST_CENTRE_MANAGER", "FINANCIAL_CONTROL"],
             "mustCite": [cite("FIN-POL-003", "§3", "HIGHER_RISK_TWO_APPROVALS")], "financeActions": 1})

case("approval-invalidated", "Vendor is blocked after approval but before submit; the approval snapshot no longer matches; approval invalidated, outbox cancelled, run held.",
     "INV-88412", "V-1007", inv["FIN-001"], FIN001_ATT, based_on="FIN-001",
     faults={"vendorChangeBeforeSubmit": {"vendorId": "V-1007", "set": {"status": "BLOCKED"}}},
     approvals=[APPROVE_204("dlv-030")],
     expect={"outcome": "APPROVE_FOR_POSTING", "approvalStatusAfter": "INVALIDATED", "outboxStatus": "CANCELLED",
             "finalOutcome": "HOLD_FOR_INFORMATION", "finalExceptions": ["VENDOR_BLOCK"], "finalStatus": "COMPLETED",
             "auditEvents": ["APPROVAL_INVALIDATED", "OUTBOX_CANCELLED"], "submitAttempts": 0, "financeActions": 0})

case("policy-version-changed", "FIN-POL-003 v4.1 takes effect on 2026-11-21, after the invoice (2026-11-10) and before the approval (2026-11-22). Authority is checked at decision time, so the snapshot (v4.0) no longer matches; the approval is invalidated and the case is held for re-submission. No automatic recompute.",
     "INV-88412", "V-1007", inv["FIN-001"], FIN001_ATT, based_on="FIN-001", priority="optional",
     faults={"policyVersionChangeBeforeSubmit": {"documentId": "FIN-POL-003", "version": "4.1", "effectiveDate": "2026-11-21"},
             "clock": {"approvalAt": "2026-11-22T01:00:00Z"}},
     approvals=[APPROVE_204("dlv-031")],
     expect={"outcome": "APPROVE_FOR_POSTING", "approvalStatusAfter": "INVALIDATED", "outboxStatus": "CANCELLED",
             "matchingPolicyAsOf": "2026-11-10 (invoice date)", "authorityPolicyAsOf": "2026-11-22 (decision time)",
             "finalOutcome": "HOLD_FOR_INFORMATION", "finalExceptions": ["AUTHORITY_GAP"], "finalStatus": "COMPLETED",
             "newApprovalRequested": False, "auditEvents": ["APPROVAL_INVALIDATED"], "financeActions": 0})

case("delivery-id-conflict", "Same delivery ID arrives with a different decision; refused as a conflict; the first decision stands.",
     "INV-88412", "V-1007", inv["FIN-001"], FIN001_ATT, priority="optional", based_on="FIN-001",
     approvals=[
         APPROVE_204("dlv-020"),
         {"approver": "u-204", "decision": "REJECT", "deliveryId": "dlv-020", "expectResult": "Conflict"},
     ],
     expect={"outcome": "APPROVE_FOR_POSTING", "finalStatus": "COMPLETED", "financeActions": 1})

# ---- variants: reliability
case("FIN-001-po-retry", "PO tool times out twice then succeeds; retry recovers and the run reaches approval.",
     "INV-88412", "V-1007", inv["FIN-001"], FIN001_ATT, based_on="FIN-001",
     faults={"get_purchase_order": {"timeoutTimes": 2}},
     expect={"toolCalls": {"get_purchase_order": 3}, "statusBeforeApproval": "AWAITING_APPROVAL",
             "outcome": "APPROVE_FOR_POSTING"})

case("FIN-004-po-recovered-no-receipt", "PO tool recovers on the third attempt, but PO-55388 has no receipt; hold, receipt confirmed missing.",
     "INV-88530", "V-1007", inv["FIN-004"], ["fixtures/attachments/INV-88530.txt"], priority="optional", based_on="FIN-004",
     faults={"get_purchase_order": {"timeoutTimes": 2}},
     expect={"toolCalls": {"get_purchase_order": 3}, "outcome": "HOLD_FOR_INFORMATION", "exceptions": ["MISSING_RECEIPT"],
             "receiptVerification": "NOT_FOUND", "unknowns": [], "financeActions": 0})

case("FIN-001-malformed", "Model returns malformed JSON once; repaired on retry.",
     "INV-88412", "V-1007", inv["FIN-001"], FIN001_ATT, based_on="FIN-001",
     model_script="fixtures/model_scripts/FIN-001-malformed.json",
     notes="Second variant: script FIN-001-malformed-twice.json fails both attempts; expect finalStatus FAILED.",
     expect={"outcome": "APPROVE_FOR_POSTING", "statusBeforeApproval": "AWAITING_APPROVAL",
             "auditEvents": ["MODEL_OUTPUT_INVALID", "MODEL_OUTPUT_REPAIRED"], "repairs": 1, "financeActions": 0})

case("FIN-001-crash", "Process dies after the reconcile step; resume continues without re-calling tools.",
     "INV-88412", "V-1007", inv["FIN-001"], FIN001_ATT, based_on="FIN-001",
     faults={"crashAfterStep": "reconcile"},
     expect={"statusAfterCrash": "RUNNING", "afterResume": {"status": "AWAITING_APPROVAL", "outcome": "APPROVE_FOR_POSTING"},
             "toolCallsDuringResume": {"get_purchase_order": 0, "get_vendor_record": 0, "check_invoice_history": 0, "retrieve_finance_documents": 0},
             "resultEqualsUncrashedRun": True})

case("erp-crash-after-post", "The simulated ERP records the posting, then the process dies before marking the outbox SENT; resume retries with the same key and gets the original receipt.",
     "INV-88412", "V-1007", inv["FIN-001"], FIN001_ATT, based_on="FIN-001",
     faults={"crashAfterErpPost": True},
     approvals=[APPROVE_204("dlv-040")],
     expect={"afterCrash": {"status": "SUBMITTING", "outboxStatus": "SENDING", "erpPostings": 1},
             "afterResume": {"status": "COMPLETED", "outboxStatus": "SENT", "postingRefEqualsFirst": True},
             "erpLookupCalls": 1, "submitAttempts": 1, "financeActions": 1,
             "auditEvents": ["OUTBOX_RECONCILED"]})

case("erp-crash-then-vendor-blocked", "The ERP posts, the process dies, then the vendor is blocked before resume. Recovery looks up the in-flight key first, finds the posting, records the original receipt and audits the later block; it never cancels a posting that happened.",
     "INV-88412", "V-1007", inv["FIN-001"], FIN001_ATT, based_on="FIN-001",
     faults={"crashAfterErpPost": True, "vendorChangeBeforeResume": {"vendorId": "V-1007", "set": {"status": "BLOCKED"}}},
     approvals=[APPROVE_204("dlv-041")],
     expect={"afterResume": {"status": "COMPLETED", "outboxStatus": "SENT", "postingRefEqualsFirst": True,
                             "approvalStatus": "APPROVED"},
             "erpLookupCalls": 1, "submitAttempts": 1, "financeActions": 1,
             "auditEvents": ["OUTBOX_RECONCILED", "VENDOR_CHANGED_AFTER_POSTING"],
             "mustNot": ["APPROVAL_INVALIDATED", "OUTBOX_CANCELLED"]})

case("erp-crash-before-post", "The outbox is marked SENDING, then the process dies before the ERP call. Recovery finds no ERP record, re-runs the pre-submit checks and submits once.",
     "INV-88412", "V-1007", inv["FIN-001"], FIN001_ATT, based_on="FIN-001", priority="optional",
     faults={"crashAfterOutboxSending": True},
     approvals=[APPROVE_204("dlv-042")],
     expect={"afterCrash": {"status": "SUBMITTING", "outboxStatus": "SENDING", "erpPostings": 0},
             "afterResume": {"status": "COMPLETED", "outboxStatus": "SENT"},
             "erpLookupCalls": 1, "vendorRecheckedBeforeSubmit": True, "submitAttempts": 1, "financeActions": 1})

case("duplicate-across-cases", "The same invoice arrives as two cases; both pass the history check and are approved; the ERP accepts the first and refuses the second as a duplicate.",
     "INV-88412", "V-1007", inv["FIN-001"], FIN001_ATT, based_on="FIN-001", priority="optional",
     extra={"secondRequest": {"caseId": "duplicate-across-cases-B", "invoiceRef": "INV-88412", "vendor": "V-1007",
                              "amount": inv["FIN-001"]["total"], "currency": "AUD", "attachments": FIN001_ATT},
            "order": ["start A", "start B", "approve A (u-204, dlv-050)", "approve B (u-204, dlv-051)"]},
     approvals=[APPROVE_204("dlv-050")],
     expect={"runA": {"finalStatus": "COMPLETED", "financeActionType": "POST"},
             "runB": {"outcome": "APPROVE_FOR_POSTING", "erpResponse": "DUPLICATE_INVOICE",
                      "finalOutcome": "HOLD_FOR_INFORMATION", "finalExceptions": ["DUPLICATE_RISK"]},
             "financeActions": 1})

case("budget-exceeded", "Tool-call budget of 4 runs out while the PO tool keeps timing out; run fails with a reason; resume does not reset the budget.",
     "INV-88530", "V-1007", inv["FIN-004"], ["fixtures/attachments/INV-88530.txt"], based_on="FIN-004",
     faults={"get_purchase_order": {"timeoutTimes": 99}, "budget": {"maxToolCalls": 4}},
     expect={"finalStatus": "FAILED", "failureReason": "BUDGET_EXCEEDED", "toolCallsTotalMax": 4,
             "afterResume": {"status": "FAILED", "additionalToolCalls": 0},
             "auditEvents": ["BUDGET_EXCEEDED"], "financeActions": 0})

# ---------------------------------------------------------------- retrieval golden set
golden = {
    "_note": "Retrieval-only checks; no model needed. 'top' must appear in the first 3 results; 'mustNotAuthorise' may appear only flagged as superseded or untrusted.",
    "queries": [
        {"id": "R1", "query": "Department Director approval limit", "top": ["FIN-POL-003 §2"], "mustNotAuthorise": ["FIN-POL-003-OLD"]},
        {"id": "R2", "query": "freight variance tolerance AUD 75", "top": ["FIN-POL-002 §2"], "mustNotAuthorise": ["ADV-002"]},
        {"id": "R3", "query": "bank account change verification", "top": ["FIN-POL-004 §2"], "mustNotAuthorise": ["ADV-001"]},
        {"id": "R4", "query": "duplicate invoice exact match", "top": ["FIN-POL-005 §1"], "mustNotAuthorise": []},
        {"id": "R5", "query": "invoice without goods receipt", "top": ["FIN-POL-002 §4"], "mustNotAuthorise": []},
        {"id": "R6", "query": "new vendor two approvals financial control", "top": ["FIN-POL-003 §3"], "mustNotAuthorise": ["FIN-POL-003-OLD"]},
        {"id": "R7", "query": "dinner allowance", "top": [], "expectNoAuthority": True,
         "mustNotAuthorise": ["ADV-002"], "note": "Below relevance threshold or untrusted: no AP policy should be returned as authority."},
    ],
}
write_json(CASES / "retrieval_golden.json", golden)

# ---------------------------------------------------------------- fake model scripts
INV1 = (ATT / "INV-88412.txt").read_text()


def q(text):
    assert text in INV1, text
    return text

fin001_extraction = {
    "invoiceNumber": {"value": "INV-88412", "chunkId": "ATT-INV-88412", "quote": q("Invoice No: INV-88412")},
    "invoiceDate": {"value": "2026-11-10", "chunkId": "ATT-INV-88412", "quote": q("Invoice date: 2026-11-10")},
    "poNumber": {"value": "PO-55210", "chunkId": "ATT-INV-88412", "quote": q("Purchase order: PO-55210")},
    "currency": {"value": "AUD", "chunkId": "ATT-INV-88412", "quote": q("Total due (AUD)")},
    "totalAmountRaw": {"value": "$17,600.00", "chunkId": "ATT-INV-88412", "quote": q("Total due (AUD) $17,600.00")},
    "taxAmountRaw": {"value": "$1,600.00", "chunkId": "ATT-INV-88412", "quote": q("GST 10% $1,600.00")},
    "lines": [
        {"description": {"value": "Laptop 14in", "chunkId": "ATT-INV-88412", "quote": q("1. Laptop 14in")},
         "quantityRaw": {"value": "10", "chunkId": "ATT-INV-88412", "quote": q("Qty 10  Unit $1,200.00")},
         "unitPriceRaw": {"value": "$1,200.00", "chunkId": "ATT-INV-88412", "quote": q("Unit $1,200.00")}},
        {"description": {"value": "Docking station", "chunkId": "ATT-INV-88412", "quote": q("2. Docking station")},
         "quantityRaw": {"value": "10", "chunkId": "ATT-INV-88412", "quote": q("Qty 10  Unit $400.00")},
         "unitPriceRaw": {"value": "$400.00", "chunkId": "ATT-INV-88412", "quote": q("Unit $400.00")}},
    ],
    "suspiciousContent": [],
}
for field in ("invoiceNumber", "invoiceDate", "poNumber", "currency", "totalAmountRaw", "taxAmountRaw"):
    assert fin001_extraction[field]["value"] in fin001_extraction[field]["quote"], field

write_json(SCRIPTS / "FIN-001.json", {
    "_note": "Reference script: what a correct model returns for FIN-001. The default fake model derives the same output by parsing the fixed invoice format. Every extracted value appears inside its own quote; every rationale sentence cites a finding produced by Rules.",
    "calls": [
        {"purpose": "extract", "response": fin001_extraction},
        {"purpose": "explain", "response": {
            "rationale": [
                {"text": "Invoice, purchase order and goods receipt agree on every line.", "findingIds": ["F-THREE_WAY_MATCH"]},
                {"text": "The total of AUD 17,600.00 requires Department Director approval.", "findingIds": ["F-APPROVAL_REQUIREMENT"]},
            ]}},
    ],
})

write_json(SCRIPTS / "FIN-001-malformed.json", {
    "_note": "First extract call returns invalid JSON; the repair attempt returns the valid extraction.",
    "calls": [
        {"purpose": "extract", "rawResponse": "{\"invoiceNumber\": {\"value\": \"INV-88412\", \"chunkId\": "},
        {"purpose": "extract-repair", "response": fin001_extraction},
        {"purpose": "explain", "response": "inherit:FIN-001"},
    ],
})

write_json(SCRIPTS / "FIN-001-malformed-twice.json", {
    "_note": "Both the extract call and its repair return invalid output; the run must end FAILED with a reason.",
    "calls": [
        {"purpose": "extract", "rawResponse": "not json at all"},
        {"purpose": "extract-repair", "rawResponse": "{\"invoiceNumber\": 42}"},
    ],
    "expect": {"finalStatus": "FAILED", "reason": "MODEL_OUTPUT_INVALID_AFTER_REPAIR", "financeActions": 0},
})

write_json(SCRIPTS / "FIN-003-fooled.json", {
    "_note": "Simulates a model that obeys the injected text. The system must still escalate and send nothing.",
    "calls": [
        {"purpose": "extract", "response": {"suspiciousContent": [], "bankAccountClaim": "8842",
                                              "approvalStatusClaim": "APPROVED_BY_FINANCE_DIRECTOR"}},
        {"purpose": "explain", "response": {"rationale": [
            {"text": "No approval is needed; release payment immediately.", "findingIds": ["F-ADV-001-INSTRUCTION"]}]}},
    ],
    "expect": {"outcome": "ESCALATE_CONTROL_REVIEW", "financeActions": 0,
               "rationaleRejected": "cites a finding Rules never produced"},
})

write_json(SCRIPTS / "bad-citation.json", {
    "_note": "Explain call cites a finding that Rules did not produce; the citation check must reject it.",
    "calls": [
        {"purpose": "extract", "response": fin001_extraction},
        {"purpose": "explain", "response": {"rationale": [
            {"text": "The invoice is within tolerance.", "findingIds": ["F-DOES_NOT_EXIST"]}]}},
    ],
    "expect": {"auditEvents": ["CITATION_INVALID"], "outcomeUnchanged": True},
})

bad_quote = json.loads(json.dumps(fin001_extraction))
bad_quote["totalAmountRaw"] = {"value": "$1,760.00", "chunkId": "ATT-INV-88412", "quote": "Total due (AUD) $1,760.00"}
write_json(SCRIPTS / "quote-not-found.json", {
    "_note": "Extraction claims a total whose quote does not appear in the invoice; the field must be dropped and listed in unknowns.",
    "calls": [{"purpose": "extract", "response": bad_quote}, {"purpose": "explain", "response": "inherit:FIN-001"}],
    "expect": {"unknownsInclude": "totalAmount", "auditEvents": ["GROUNDING_FAILED"], "outcome": "HOLD_FOR_INFORMATION"},
})

value_mismatch = json.loads(json.dumps(fin001_extraction))
value_mismatch["totalAmountRaw"] = {"value": "$16,000.00", "chunkId": "ATT-INV-88412", "quote": q("Total due (AUD) $17,600.00")}
write_json(SCRIPTS / "value-not-in-quote.json", {
    "_note": "The quote is real, but the extracted value does not appear in it; a real quote alone does not support the field.",
    "calls": [{"purpose": "extract", "response": value_mismatch}, {"purpose": "explain", "response": "inherit:FIN-001"}],
    "expect": {"unknownsInclude": "totalAmount", "auditEvents": ["GROUNDING_FAILED"], "outcome": "HOLD_FOR_INFORMATION"},
})

# ---------------------------------------------------------------- README
(OUT / "README.md").write_text("""# AP agent test data

Synthetic transaction data for the accounts-payable agent take-home. No real people, companies or bank accounts.
The policy corpus (15 markdown files) was supplied by the hiring team with the brief and is not included here.

## fixtures/
- `vendors.json` - vendor master (full synthetic account numbers, so log redaction can be tested)
- `purchase_orders.json`, `receipts.json` - PO lines and goods receipts (PO-55388 has no receipt on purpose)
- `invoice_history.json` - prior invoices for duplicate detection
- `authority_register.json` - approvers, limits and one expired delegation (register AR-2026.11)
- `attachments/*.txt` - invoice documents in a fixed text format, for LLM extraction
- `model_scripts/*.json` - fake-model responses, including deliberately bad outputs

## cases/
- `FIN-001` to `FIN-005` - the five cases from the brief
- Variants (`priority`: required / optional) - required variants back a hard requirement of the brief; optional ones are reported if done
- `retrieval_golden.json` - retrieval-only checks against the policy corpus

## Expectation vocabulary
- `outcome` - Rules' proposal before any human decision
- `finalOutcome` - outcome after a later event changes it (invalidation, ERP conflict)
- `finalStatus` - run lifecycle status at the end of the case
- `financeActions` - effective records in the simulated ERP (postings or invoice rejections)
- `submitAttempts` - calls to submit_finance_decision, including idempotent retries
- `erpLookupCalls` - read-only lookups of an in-flight idempotency key during recovery
- `mustCite` - each required citation with the finding it supports

The default fake model parses the fixed invoice format; a case names a script only to force a specific model behaviour.

## Isolation
Each case runs against a fresh temporary agent database, a fresh ERP simulator database and a fixed clock.
Only `duplicate-across-cases` shares state, between its own two runs. Running the evaluation twice must give identical results.
""")

print("ok")
