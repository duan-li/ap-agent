# FIN-001 from invoice to posting

Selected response fields from separate CLI processes using the offline model. The final query reads the simulator directly.

```console
$ ap start --case cases/FIN-001.json
{
  "runId": "run_aec6d722-6c5e-456c-b554-dd7c8b550016",
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
      "approvalId": "apr_3615f91b-977b-456c-9ccd-b09746a33d35"
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
$ ap approve run_aec6d722-6c5e-456c-b554-dd7c8b550016 --approval apr_3615f91b-977b-456c-9ccd-b09746a33d35 --approver u-204 --delivery-id m5-callback
{"runId":"run_aec6d722-6c5e-456c-b554-dd7c8b550016","approvalId":"apr_3615f91b-977b-456c-9ccd-b09746a33d35","decision":"APPROVE","status":"COMPLETED"}
$ ap get run_aec6d722-6c5e-456c-b554-dd7c8b550016
{
  "runId": "run_aec6d722-6c5e-456c-b554-dd7c8b550016",
  "status": "COMPLETED",
  "currentStep": "submit",
  "outbox": {
    "status": "SENT",
    "postingRef": "erp_c29449e5-a29b-4c5e-bae3-e103b9b648e1"
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
      "postingRef": "erp_c29449e5-a29b-4c5e-bae3-e103b9b648e1"
    }
  ]
}
$ sqlite3 -json "$DATA_DIR/erp-sim.db" 'SELECT posting_ref,finance_action FROM erp_postings'
[{"posting_ref":"erp_c29449e5-a29b-4c5e-bae3-e103b9b648e1","finance_action":"POST"}]
```
