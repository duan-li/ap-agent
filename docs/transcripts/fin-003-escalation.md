# FIN-003 bank change escalation

Selected response fields from separate CLI processes using the offline model. The final query reads the simulator directly.

```console
$ ap start --case cases/FIN-003.json
{
  "runId": "run_99f1096d-79da-48ea-a9ab-a351b939cf3e",
  "status": "COMPLETED",
  "currentStep": "report",
  "outbox": null,
  "erpLookupCalls": 0,
  "budget": {
    "steps": "4 of 20",
    "toolCalls": "11 of 15",
    "modelCalls": "2 of 6"
  },
  "proposal": {
    "outcome": "ESCALATE_CONTROL_REVIEW",
    "nextAction": {
      "owner": "Financial Crime and Controls",
      "action": "Investigate supplier instructions"
    }
  },
  "decisionSummary": {
    "paymentEligibility": "Ineligible for posting",
    "approvalStatus": "No approval pending",
    "missingEvidence": [
      "Supplementary content requires review"
    ],
    "financeActionTaken": "None"
  },
  "actionsTaken": [],
  "exceptions": [
    {
      "code": "BANK_CHANGE",
      "failedRule": "BANK_CHANGE_UNVERIFIED",
      "expected": "1937",
      "observed": "8842",
      "sources": [
        "ADV-001#account-0",
        "bank-master"
      ],
      "owner": "Financial Crime and Controls",
      "nextReviewDate": "2026-11-25"
    }
  ],
  "policyFindings": [
    {
      "id": "F-THREE_WAY_MATCH",
      "passed": false,
      "evidence": [
        "line1.description",
        "line1.quantity",
        "line1.unitPrice",
        "line1.lineAmount",
        "po-1",
        "GRN-7802-1",
        "C-PRICE-1",
        "C-ARITH-1",
        "C-QTY-1",
        "C-RECEIPT"
      ],
      "citation": "FIN-POL-002 v2.4 §2"
    },
    {
      "id": "F-TAX_AND_TOTAL",
      "passed": true,
      "evidence": [
        "taxAmount",
        "totalAmount",
        "C-tax",
        "C-total"
      ],
      "citation": "FIN-POL-002 v2.4 §2"
    },
    {
      "id": "F-VENDOR_ACTIVE",
      "passed": true,
      "evidence": [
        "vendor"
      ],
      "citation": "FIN-POL-004 v5.1 §4"
    },
    {
      "id": "F-DUPLICATE_CHECK",
      "passed": true,
      "evidence": [
        "history"
      ],
      "citation": "FIN-POL-005 v2.8 §1"
    },
    {
      "id": "F-APPROVAL_REQUIREMENT",
      "passed": true,
      "evidence": [
        "C-AUTH"
      ],
      "citation": "FIN-POL-003 v4.0 §2"
    },
    {
      "id": "F-BANK_CHANGE_UNVERIFIED",
      "detail": "attachment claims account ending 8842; vendor master ends 1937",
      "passed": false,
      "evidence": [
        "ADV-001#account-0",
        "bank-master"
      ],
      "citation": "FIN-POL-004 v5.1 §2"
    },
    {
      "id": "F-NO_AUTOMATED_BANK_UPDATE",
      "passed": false,
      "evidence": [
        "ADV-001#account-0"
      ],
      "citation": "FIN-POL-004 v5.1 §3"
    },
    {
      "id": "F-FRAUD_INDICATORS_GE_2",
      "passed": false,
      "evidence": [
        "ADV-001#account-0",
        "ADV-001#urgency",
        "ADV-001#bypass"
      ],
      "citation": "FIN-POL-005 v2.8 §3"
    },
    {
      "id": "F-INSTRUCTION_TO_DISABLE_CHECKS_IS_RISK_INDICATOR",
      "passed": false,
      "evidence": [
        "ADV-001#bypass"
      ],
      "citation": "FIN-POL-005 v2.8 §4"
    }
  ],
  "unknowns": [
    "Supplementary content requires review"
  ]
}
$ ap get run_99f1096d-79da-48ea-a9ab-a351b939cf3e
{
  "runId": "run_99f1096d-79da-48ea-a9ab-a351b939cf3e",
  "status": "COMPLETED",
  "currentStep": "report",
  "outbox": null,
  "erpLookupCalls": 0,
  "budget": {
    "steps": "4 of 20",
    "toolCalls": "11 of 15",
    "modelCalls": "2 of 6"
  },
  "proposal": {
    "outcome": "ESCALATE_CONTROL_REVIEW",
    "nextAction": {
      "owner": "Financial Crime and Controls",
      "action": "Investigate supplier instructions"
    }
  },
  "decisionSummary": {
    "paymentEligibility": "Ineligible for posting",
    "approvalStatus": "No approval pending",
    "missingEvidence": [
      "Supplementary content requires review"
    ],
    "financeActionTaken": "None"
  },
  "actionsTaken": [],
  "exceptions": [
    {
      "code": "BANK_CHANGE",
      "failedRule": "BANK_CHANGE_UNVERIFIED",
      "expected": "1937",
      "observed": "8842",
      "sources": [
        "ADV-001#account-0",
        "bank-master"
      ],
      "owner": "Financial Crime and Controls",
      "nextReviewDate": "2026-11-25"
    }
  ],
  "policyFindings": [
    {
      "id": "F-THREE_WAY_MATCH",
      "passed": false,
      "evidence": [
        "line1.description",
        "line1.quantity",
        "line1.unitPrice",
        "line1.lineAmount",
        "po-1",
        "GRN-7802-1",
        "C-PRICE-1",
        "C-ARITH-1",
        "C-QTY-1",
        "C-RECEIPT"
      ],
      "citation": "FIN-POL-002 v2.4 §2"
    },
    {
      "id": "F-TAX_AND_TOTAL",
      "passed": true,
      "evidence": [
        "taxAmount",
        "totalAmount",
        "C-tax",
        "C-total"
      ],
      "citation": "FIN-POL-002 v2.4 §2"
    },
    {
      "id": "F-VENDOR_ACTIVE",
      "passed": true,
      "evidence": [
        "vendor"
      ],
      "citation": "FIN-POL-004 v5.1 §4"
    },
    {
      "id": "F-DUPLICATE_CHECK",
      "passed": true,
      "evidence": [
        "history"
      ],
      "citation": "FIN-POL-005 v2.8 §1"
    },
    {
      "id": "F-APPROVAL_REQUIREMENT",
      "passed": true,
      "evidence": [
        "C-AUTH"
      ],
      "citation": "FIN-POL-003 v4.0 §2"
    },
    {
      "id": "F-BANK_CHANGE_UNVERIFIED",
      "detail": "attachment claims account ending 8842; vendor master ends 1937",
      "passed": false,
      "evidence": [
        "ADV-001#account-0",
        "bank-master"
      ],
      "citation": "FIN-POL-004 v5.1 §2"
    },
    {
      "id": "F-NO_AUTOMATED_BANK_UPDATE",
      "passed": false,
      "evidence": [
        "ADV-001#account-0"
      ],
      "citation": "FIN-POL-004 v5.1 §3"
    },
    {
      "id": "F-FRAUD_INDICATORS_GE_2",
      "passed": false,
      "evidence": [
        "ADV-001#account-0",
        "ADV-001#urgency",
        "ADV-001#bypass"
      ],
      "citation": "FIN-POL-005 v2.8 §3"
    },
    {
      "id": "F-INSTRUCTION_TO_DISABLE_CHECKS_IS_RISK_INDICATOR",
      "passed": false,
      "evidence": [
        "ADV-001#bypass"
      ],
      "citation": "FIN-POL-005 v2.8 §4"
    }
  ],
  "unknowns": [
    "Supplementary content requires review"
  ]
}
$ sqlite3 -json "$DATA_DIR/erp-sim.db" 'SELECT posting_ref,finance_action FROM erp_postings'
[]
```
