# Fault drills

These captures use separate CLI processes and fresh databases per drill. Run views show selected response fields. Audit lines below each view come from its events array. The process-kill drill uses the system clock so the worker lease can expire.

## FIN-004

```console
$ ap start --case cases/FIN-004.json
{
  "runId": "run_a30cf2a4-13f2-41ff-912b-f20686b00bb5",
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
    "outcome": "HOLD_FOR_INFORMATION",
    "nextAction": {
      "owner": "requester or receipter",
      "action": "Provide the goods receipt for PO-55388; AP then re-submits the invoice as a new run"
    }
  },
  "decisionSummary": {
    "paymentEligibility": "Ineligible for posting",
    "approvalStatus": "No approval pending",
    "missingEvidence": [
      "purchase_order:PO-55388",
      "goods_receipt:PO-55388"
    ],
    "financeActionTaken": "None"
  },
  "actionsTaken": [],
  "exceptions": [
    {
      "code": "MISSING_RECEIPT",
      "failedRule": "RECEIPT_REQUIRED_NOT_INFERRED",
      "expected": "A goods receipt for PO-55388 before payment",
      "observed": "Unable to verify goods receipt for PO-55388: the purchase order system failed on 3 attempts (TIMEOUT)",
      "sources": [
        "C-RECEIPT",
        "F-RECEIPT_REQUIRED_NOT_INFERRED"
      ],
      "owner": "requester or receipter",
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
        "C-RECEIPT"
      ],
      "citation": "FIN-POL-002 v2.4 §2"
    },
    {
      "id": "F-TAX_AND_TOTAL",
      "passed": false,
      "evidence": [
        "taxAmount",
        "totalAmount"
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
      "id": "F-RECEIPT_REQUIRED_NOT_INFERRED",
      "passed": false,
      "evidence": [
        "C-RECEIPT"
      ],
      "citation": "FIN-POL-002 v2.4 §4"
    },
    {
      "id": "F-MISSING_EVIDENCE_HOLD",
      "passed": false,
      "evidence": [
        "po-lookup"
      ],
      "citation": "FIN-POL-001 v3.2 §5"
    }
  ],
  "unknowns": [
    "purchase_order:PO-55388",
    "goods_receipt:PO-55388"
  ]
}
$ ap get run_a30cf2a4-13f2-41ff-912b-f20686b00bb5
{
  "runId": "run_a30cf2a4-13f2-41ff-912b-f20686b00bb5",
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
    "outcome": "HOLD_FOR_INFORMATION",
    "nextAction": {
      "owner": "requester or receipter",
      "action": "Provide the goods receipt for PO-55388; AP then re-submits the invoice as a new run"
    }
  },
  "decisionSummary": {
    "paymentEligibility": "Ineligible for posting",
    "approvalStatus": "No approval pending",
    "missingEvidence": [
      "purchase_order:PO-55388",
      "goods_receipt:PO-55388"
    ],
    "financeActionTaken": "None"
  },
  "actionsTaken": [],
  "exceptions": [
    {
      "code": "MISSING_RECEIPT",
      "failedRule": "RECEIPT_REQUIRED_NOT_INFERRED",
      "expected": "A goods receipt for PO-55388 before payment",
      "observed": "Unable to verify goods receipt for PO-55388: the purchase order system failed on 3 attempts (TIMEOUT)",
      "sources": [
        "C-RECEIPT",
        "F-RECEIPT_REQUIRED_NOT_INFERRED"
      ],
      "owner": "requester or receipter",
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
        "C-RECEIPT"
      ],
      "citation": "FIN-POL-002 v2.4 §2"
    },
    {
      "id": "F-TAX_AND_TOTAL",
      "passed": false,
      "evidence": [
        "taxAmount",
        "totalAmount"
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
      "id": "F-RECEIPT_REQUIRED_NOT_INFERRED",
      "passed": false,
      "evidence": [
        "C-RECEIPT"
      ],
      "citation": "FIN-POL-002 v2.4 §4"
    },
    {
      "id": "F-MISSING_EVIDENCE_HOLD",
      "passed": false,
      "evidence": [
        "po-lookup"
      ],
      "citation": "FIN-POL-001 v3.2 §5"
    }
  ],
  "unknowns": [
    "purchase_order:PO-55388",
    "goods_receipt:PO-55388"
  ]
}
{"name":"get_purchase_order","attempt":1,"outcome":"TIMEOUT","durationMs":1,"retryInMs":100,"ts":"2026-11-22T08:53:59.038Z","type":"TOOL_CALL","runId":"run_a30cf2a4-13f2-41ff-912b-f20686b00bb5","correlationId":"14dfe03f-5797-46c6-9dfb-f90788d943a5","eventId":"evt_5"}
{"name":"get_purchase_order","attempt":2,"outcome":"TIMEOUT","durationMs":0,"retryInMs":200,"ts":"2026-11-22T08:53:59.141Z","type":"TOOL_CALL","runId":"run_a30cf2a4-13f2-41ff-912b-f20686b00bb5","correlationId":"14dfe03f-5797-46c6-9dfb-f90788d943a5","eventId":"evt_6"}
{"name":"get_purchase_order","attempt":3,"outcome":"TIMEOUT","durationMs":0,"ts":"2026-11-22T08:53:59.344Z","type":"TOOL_CALL","runId":"run_a30cf2a4-13f2-41ff-912b-f20686b00bb5","correlationId":"14dfe03f-5797-46c6-9dfb-f90788d943a5","eventId":"evt_7"}
$ sqlite3 -json "$DATA_DIR/erp-sim.db" 'SELECT posting_ref,finance_action FROM erp_postings'
[]
```

## approval-invalidated

```console
$ ap start --case cases/approval-invalidated.json
{
  "runId": "run_89bc26d5-d1df-49ab-b978-53a52d12d888",
  "status": "AWAITING_APPROVAL",
  "currentStep": "request_approval",
  "outbox": null,
  "erpLookupCalls": 0,
  "budget": {
    "steps": "5 of 20",
    "toolCalls": "7 of 15",
    "modelCalls": "2 of 6"
  },
  "proposal": {
    "outcome": "APPROVE_FOR_POSTING",
    "nextAction": {
      "type": "REQUEST_APPROVAL",
      "roles": [
        "DEPARTMENT_DIRECTOR"
      ],
      "approvalId": "apr_feaf24c8-5eac-4900-a034-3304b2f43746"
    }
  },
  "decisionSummary": {
    "paymentEligibility": "Eligible for posting once approved",
    "approvalStatus": "Awaiting DEPARTMENT_DIRECTOR (0 of 1 approvals)",
    "missingEvidence": [],
    "financeActionTaken": "None"
  },
  "actionsTaken": []
}
$ ap approve run_89bc26d5-d1df-49ab-b978-53a52d12d888 --approval apr_feaf24c8-5eac-4900-a034-3304b2f43746 --approver u-204 --delivery-id m5-callback
{"runId":"run_89bc26d5-d1df-49ab-b978-53a52d12d888","approvalId":"apr_feaf24c8-5eac-4900-a034-3304b2f43746","decision":"APPROVE","status":"COMPLETED"}
$ ap get run_89bc26d5-d1df-49ab-b978-53a52d12d888
{
  "runId": "run_89bc26d5-d1df-49ab-b978-53a52d12d888",
  "status": "COMPLETED",
  "currentStep": "invalidate_approval",
  "outbox": {
    "status": "CANCELLED",
    "postingRef": null
  },
  "erpLookupCalls": 0,
  "budget": {
    "steps": "6 of 20",
    "toolCalls": "10 of 15",
    "modelCalls": "2 of 6"
  },
  "proposal": {
    "outcome": "HOLD_FOR_INFORMATION",
    "nextAction": {
      "owner": "Accounts Payable",
      "action": "Review the changed evidence and re-submit as a new run"
    }
  },
  "decisionSummary": {
    "paymentEligibility": "Ineligible for posting",
    "approvalStatus": "Invalidated",
    "missingEvidence": [],
    "financeActionTaken": "NONE"
  },
  "actionsTaken": []
}
{"approvalId":"apr_feaf24c8-5eac-4900-a034-3304b2f43746","code":"VENDOR_BLOCK","observed":"BLOCKED","ts":"2026-11-22T08:54:00.290Z","type":"APPROVAL_INVALIDATED","runId":"run_89bc26d5-d1df-49ab-b978-53a52d12d888","correlationId":"719122bd-a6ab-4b06-ad6d-289848f935da","eventId":"evt_29"}
{"approvalId":"apr_feaf24c8-5eac-4900-a034-3304b2f43746","ts":"2026-11-22T08:54:00.291Z","type":"OUTBOX_CANCELLED","runId":"run_89bc26d5-d1df-49ab-b978-53a52d12d888","correlationId":"719122bd-a6ab-4b06-ad6d-289848f935da","eventId":"evt_30"}
$ sqlite3 -json "$DATA_DIR/erp-sim.db" 'SELECT posting_ref,finance_action FROM erp_postings'
[]
```

## erp-crash-after-post

```console
$ ap start --case cases/erp-crash-after-post.json
{
  "runId": "run_28ec4ab1-3716-49b6-a70b-d3ca34424e8d",
  "status": "AWAITING_APPROVAL",
  "currentStep": "request_approval",
  "outbox": null,
  "erpLookupCalls": 0,
  "budget": {
    "steps": "5 of 20",
    "toolCalls": "7 of 15",
    "modelCalls": "2 of 6"
  },
  "proposal": {
    "outcome": "APPROVE_FOR_POSTING",
    "nextAction": {
      "type": "REQUEST_APPROVAL",
      "roles": [
        "DEPARTMENT_DIRECTOR"
      ],
      "approvalId": "apr_89975d84-bc93-49ea-b581-2524481b47e4"
    }
  },
  "decisionSummary": {
    "paymentEligibility": "Eligible for posting once approved",
    "approvalStatus": "Awaiting DEPARTMENT_DIRECTOR (0 of 1 approvals)",
    "missingEvidence": [],
    "financeActionTaken": "None"
  },
  "actionsTaken": []
}
$ ap approve run_28ec4ab1-3716-49b6-a70b-d3ca34424e8d --approval apr_89975d84-bc93-49ea-b581-2524481b47e4 --approver u-204 --delivery-id m5-callback
{"type":"Transient","runId":"run_28ec4ab1-3716-49b6-a70b-d3ca34424e8d"}
$ sqlite3 -json "$DATA_DIR/erp-sim.db" 'SELECT posting_ref,finance_action FROM erp_postings'
[{"posting_ref":"erp_6007e5f5-f91e-4555-960d-0cf678d6bb7f","finance_action":"POST"}]
$ ap resume run_28ec4ab1-3716-49b6-a70b-d3ca34424e8d
{
  "runId": "run_28ec4ab1-3716-49b6-a70b-d3ca34424e8d",
  "status": "COMPLETED",
  "currentStep": "submit",
  "outbox": {
    "status": "SENT",
    "postingRef": "erp_6007e5f5-f91e-4555-960d-0cf678d6bb7f"
  },
  "erpLookupCalls": 1,
  "budget": {
    "steps": "7 of 20",
    "toolCalls": "12 of 15",
    "modelCalls": "2 of 6"
  },
  "proposal": {
    "outcome": "APPROVE_FOR_POSTING",
    "nextAction": {
      "owner": "Accounts Payable",
      "action": "Posting complete"
    }
  },
  "decisionSummary": {
    "paymentEligibility": "Posted",
    "approvalStatus": "Approved",
    "missingEvidence": [],
    "financeActionTaken": "POST"
  },
  "actionsTaken": [
    {
      "action": "POST",
      "postingRef": "erp_6007e5f5-f91e-4555-960d-0cf678d6bb7f"
    }
  ]
}
$ ap get run_28ec4ab1-3716-49b6-a70b-d3ca34424e8d
{
  "runId": "run_28ec4ab1-3716-49b6-a70b-d3ca34424e8d",
  "status": "COMPLETED",
  "currentStep": "submit",
  "outbox": {
    "status": "SENT",
    "postingRef": "erp_6007e5f5-f91e-4555-960d-0cf678d6bb7f"
  },
  "erpLookupCalls": 1,
  "budget": {
    "steps": "7 of 20",
    "toolCalls": "12 of 15",
    "modelCalls": "2 of 6"
  },
  "proposal": {
    "outcome": "APPROVE_FOR_POSTING",
    "nextAction": {
      "owner": "Accounts Payable",
      "action": "Posting complete"
    }
  },
  "decisionSummary": {
    "paymentEligibility": "Posted",
    "approvalStatus": "Approved",
    "missingEvidence": [],
    "financeActionTaken": "POST"
  },
  "actionsTaken": [
    {
      "action": "POST",
      "postingRef": "erp_6007e5f5-f91e-4555-960d-0cf678d6bb7f"
    }
  ]
}
{"idempotencyKey":"run_28ec4ab1-3716-49b6-a70b-d3ca34424e8d/apr_89975d84-bc93-49ea-b581-2524481b47e4/POST","outcome":"FOUND","ts":"2026-11-22T08:54:01.547Z","type":"ERP_LOOKUP","runId":"run_28ec4ab1-3716-49b6-a70b-d3ca34424e8d","correlationId":"5eea5cbe-bf7a-40ab-b6a1-813665250fa0","eventId":"evt_31"}
{"postingRef":"erp_6007e5f5-f91e-4555-960d-0cf678d6bb7f","idempotencyKey":"run_28ec4ab1-3716-49b6-a70b-d3ca34424e8d/apr_89975d84-bc93-49ea-b581-2524481b47e4/POST","ts":"2026-11-22T08:54:01.551Z","type":"OUTBOX_RECONCILED","runId":"run_28ec4ab1-3716-49b6-a70b-d3ca34424e8d","correlationId":"5eea5cbe-bf7a-40ab-b6a1-813665250fa0","eventId":"evt_33"}
$ sqlite3 -json "$DATA_DIR/erp-sim.db" 'SELECT posting_ref,finance_action FROM erp_postings'
[{"posting_ref":"erp_6007e5f5-f91e-4555-960d-0cf678d6bb7f","finance_action":"POST"}]
```

## erp-crash-then-vendor-blocked

```console
$ ap start --case cases/erp-crash-then-vendor-blocked.json
{
  "runId": "run_0b87efc2-1be6-42c2-b52e-87d2077e65db",
  "status": "AWAITING_APPROVAL",
  "currentStep": "request_approval",
  "outbox": null,
  "erpLookupCalls": 0,
  "budget": {
    "steps": "5 of 20",
    "toolCalls": "7 of 15",
    "modelCalls": "2 of 6"
  },
  "proposal": {
    "outcome": "APPROVE_FOR_POSTING",
    "nextAction": {
      "type": "REQUEST_APPROVAL",
      "roles": [
        "DEPARTMENT_DIRECTOR"
      ],
      "approvalId": "apr_54b3cb09-13e0-4833-a37b-5c88dbf9226c"
    }
  },
  "decisionSummary": {
    "paymentEligibility": "Eligible for posting once approved",
    "approvalStatus": "Awaiting DEPARTMENT_DIRECTOR (0 of 1 approvals)",
    "missingEvidence": [],
    "financeActionTaken": "None"
  },
  "actionsTaken": []
}
$ ap approve run_0b87efc2-1be6-42c2-b52e-87d2077e65db --approval apr_54b3cb09-13e0-4833-a37b-5c88dbf9226c --approver u-204 --delivery-id m5-callback
{"type":"Transient","runId":"run_0b87efc2-1be6-42c2-b52e-87d2077e65db"}
$ sqlite3 -json "$DATA_DIR/erp-sim.db" 'SELECT posting_ref,finance_action FROM erp_postings'
[{"posting_ref":"erp_4134156b-067a-4d69-82a3-a67151d0060f","finance_action":"POST"}]
$ ap resume run_0b87efc2-1be6-42c2-b52e-87d2077e65db
{
  "runId": "run_0b87efc2-1be6-42c2-b52e-87d2077e65db",
  "status": "COMPLETED",
  "currentStep": "submit",
  "outbox": {
    "status": "SENT",
    "postingRef": "erp_4134156b-067a-4d69-82a3-a67151d0060f"
  },
  "erpLookupCalls": 1,
  "budget": {
    "steps": "7 of 20",
    "toolCalls": "12 of 15",
    "modelCalls": "2 of 6"
  },
  "proposal": {
    "outcome": "APPROVE_FOR_POSTING",
    "nextAction": {
      "owner": "Accounts Payable",
      "action": "Posting complete"
    }
  },
  "decisionSummary": {
    "paymentEligibility": "Posted",
    "approvalStatus": "Approved",
    "missingEvidence": [],
    "financeActionTaken": "POST"
  },
  "actionsTaken": [
    {
      "action": "POST",
      "postingRef": "erp_4134156b-067a-4d69-82a3-a67151d0060f"
    }
  ]
}
$ ap get run_0b87efc2-1be6-42c2-b52e-87d2077e65db
{
  "runId": "run_0b87efc2-1be6-42c2-b52e-87d2077e65db",
  "status": "COMPLETED",
  "currentStep": "submit",
  "outbox": {
    "status": "SENT",
    "postingRef": "erp_4134156b-067a-4d69-82a3-a67151d0060f"
  },
  "erpLookupCalls": 1,
  "budget": {
    "steps": "7 of 20",
    "toolCalls": "12 of 15",
    "modelCalls": "2 of 6"
  },
  "proposal": {
    "outcome": "APPROVE_FOR_POSTING",
    "nextAction": {
      "owner": "Accounts Payable",
      "action": "Posting complete"
    }
  },
  "decisionSummary": {
    "paymentEligibility": "Posted",
    "approvalStatus": "Approved",
    "missingEvidence": [],
    "financeActionTaken": "POST"
  },
  "actionsTaken": [
    {
      "action": "POST",
      "postingRef": "erp_4134156b-067a-4d69-82a3-a67151d0060f"
    }
  ]
}
{"idempotencyKey":"run_0b87efc2-1be6-42c2-b52e-87d2077e65db/apr_54b3cb09-13e0-4833-a37b-5c88dbf9226c/POST","outcome":"FOUND","ts":"2026-11-22T08:54:03.126Z","type":"ERP_LOOKUP","runId":"run_0b87efc2-1be6-42c2-b52e-87d2077e65db","correlationId":"3eb3cb88-c041-46c8-82da-bfa02c554490","eventId":"evt_31"}
{"postingRef":"erp_4134156b-067a-4d69-82a3-a67151d0060f","idempotencyKey":"run_0b87efc2-1be6-42c2-b52e-87d2077e65db/apr_54b3cb09-13e0-4833-a37b-5c88dbf9226c/POST","ts":"2026-11-22T08:54:03.130Z","type":"OUTBOX_RECONCILED","runId":"run_0b87efc2-1be6-42c2-b52e-87d2077e65db","correlationId":"3eb3cb88-c041-46c8-82da-bfa02c554490","eventId":"evt_33"}
{"vendorId":"V-1007","status":"BLOCKED","bankAccountVersion":"2024-03-11","ts":"2026-11-22T08:54:03.132Z","type":"VENDOR_CHANGED_AFTER_POSTING","runId":"run_0b87efc2-1be6-42c2-b52e-87d2077e65db","correlationId":"3eb3cb88-c041-46c8-82da-bfa02c554490","eventId":"evt_35"}
$ sqlite3 -json "$DATA_DIR/erp-sim.db" 'SELECT posting_ref,finance_action FROM erp_postings'
[{"posting_ref":"erp_4134156b-067a-4d69-82a3-a67151d0060f","finance_action":"POST"}]
```

## FIN-005

```console
$ ap start --case cases/FIN-005.json
{
  "runId": "run_1cf96c1e-3f5b-4dbc-a261-61c97b80dc35",
  "status": "AWAITING_APPROVAL",
  "currentStep": "request_approval",
  "outbox": null,
  "erpLookupCalls": 0,
  "budget": {
    "steps": "5 of 20",
    "toolCalls": "7 of 15",
    "modelCalls": "2 of 6"
  },
  "proposal": {
    "outcome": "APPROVE_FOR_POSTING",
    "nextAction": {
      "type": "REQUEST_APPROVAL",
      "roles": [
        "DEPARTMENT_DIRECTOR"
      ],
      "approvalId": "apr_b0734629-b74a-4fd5-ade1-d0ba2ab65c2d"
    }
  },
  "decisionSummary": {
    "paymentEligibility": "Eligible for posting once approved",
    "approvalStatus": "Awaiting DEPARTMENT_DIRECTOR (0 of 1 approvals)",
    "missingEvidence": [],
    "financeActionTaken": "None"
  },
  "actionsTaken": []
}
$ ap approve run_1cf96c1e-3f5b-4dbc-a261-61c97b80dc35 --approval apr_b0734629-b74a-4fd5-ade1-d0ba2ab65c2d --approver u-204 --delivery-id m5-callback
{"runId":"run_1cf96c1e-3f5b-4dbc-a261-61c97b80dc35","approvalId":"apr_b0734629-b74a-4fd5-ade1-d0ba2ab65c2d","decision":"APPROVE","status":"COMPLETED"}
$ ap approve run_1cf96c1e-3f5b-4dbc-a261-61c97b80dc35 --approval apr_b0734629-b74a-4fd5-ade1-d0ba2ab65c2d --approver u-204 --delivery-id m5-callback
{"runId":"run_1cf96c1e-3f5b-4dbc-a261-61c97b80dc35","approvalId":"apr_b0734629-b74a-4fd5-ade1-d0ba2ab65c2d","decision":"APPROVE","status":"COMPLETED"}
$ ap get run_1cf96c1e-3f5b-4dbc-a261-61c97b80dc35
{
  "runId": "run_1cf96c1e-3f5b-4dbc-a261-61c97b80dc35",
  "status": "COMPLETED",
  "currentStep": "submit",
  "outbox": {
    "status": "SENT",
    "postingRef": "erp_cfe44c10-2962-4763-9be9-63186728c417"
  },
  "erpLookupCalls": 0,
  "budget": {
    "steps": "7 of 20",
    "toolCalls": "11 of 15",
    "modelCalls": "2 of 6"
  },
  "proposal": {
    "outcome": "APPROVE_FOR_POSTING",
    "nextAction": {
      "owner": "Accounts Payable",
      "action": "Posting complete"
    }
  },
  "decisionSummary": {
    "paymentEligibility": "Posted",
    "approvalStatus": "Approved",
    "missingEvidence": [],
    "financeActionTaken": "POST"
  },
  "actionsTaken": [
    {
      "action": "POST",
      "postingRef": "erp_cfe44c10-2962-4763-9be9-63186728c417"
    }
  ]
}
{"approvalId":"apr_b0734629-b74a-4fd5-ade1-d0ba2ab65c2d","ts":"2026-11-22T08:54:04.465Z","type":"APPROVAL_DUPLICATE_IGNORED","runId":"run_1cf96c1e-3f5b-4dbc-a261-61c97b80dc35","correlationId":"3267fa06-8b4b-4210-ac16-eda05ade19df","eventId":"evt_32"}
$ sqlite3 -json "$DATA_DIR/erp-sim.db" 'SELECT posting_ref,finance_action FROM erp_postings'
[{"posting_ref":"erp_cfe44c10-2962-4763-9be9-63186728c417","finance_action":"POST"}]
```

## kill

```console
$ ap start --case cases/FIN-001.json
{"name":"reconcile","ts":"2026-11-22T08:54:05.174Z","type":"STEP_COMPLETED","runId":"run_4ba92e2e-ad01-44d5-bee7-3fff8e85b8a1","correlationId":"bd9856f0-0641-48c0-98cc-a42e7e91318b"}
$ kill -9 3596
$ ap get run_4ba92e2e-ad01-44d5-bee7-3fff8e85b8a1
{"runId":"run_4ba92e2e-ad01-44d5-bee7-3fff8e85b8a1","status":"RUNNING","currentStep":"reconcile","outbox":null,"erpLookupCalls":0,"budget":{"steps":"3 of 20","toolCalls":"7 of 15","modelCalls":"1 of 6"}}
$ ap resume run_4ba92e2e-ad01-44d5-bee7-3fff8e85b8a1
{
  "runId": "run_4ba92e2e-ad01-44d5-bee7-3fff8e85b8a1",
  "status": "AWAITING_APPROVAL",
  "currentStep": "request_approval",
  "outbox": null,
  "erpLookupCalls": 0,
  "budget": {
    "steps": "5 of 20",
    "toolCalls": "7 of 15",
    "modelCalls": "2 of 6"
  },
  "proposal": {
    "outcome": "APPROVE_FOR_POSTING",
    "nextAction": {
      "type": "REQUEST_APPROVAL",
      "roles": [
        "DEPARTMENT_DIRECTOR"
      ],
      "approvalId": "apr_0316c274-13f4-4121-801b-9c9cfb2c5aca"
    }
  },
  "decisionSummary": {
    "paymentEligibility": "Eligible for posting once approved",
    "approvalStatus": "Awaiting DEPARTMENT_DIRECTOR (0 of 1 approvals)",
    "missingEvidence": [],
    "financeActionTaken": "None"
  },
  "actionsTaken": []
}
```
