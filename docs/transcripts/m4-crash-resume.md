# FIN-001 process kill and resume

A fresh CLI process resumed FIN-001 from the committed reconcile step. The fake model ran on Node 22.23.5 with a temporary data directory. The driver sent SIGKILL to the start process when its explanation call began. The excerpts below show its audit events and the selected fields from each CLI response.

```console
$ ap start --case cases/FIN-001.json
{"actor":"local-operator","source":"cli","ts":"2026-11-22T08:16:45.628Z","type":"RUN_STARTED","runId":"run_2c0be60c-db38-4d93-bb6d-348658e86c8c","correlationId":"c6eeecc9-2594-41d1-ba9e-1fad422112c7"}
{"name":"extract","ts":"2026-11-22T08:16:45.634Z","type":"STEP_COMPLETED","runId":"run_2c0be60c-db38-4d93-bb6d-348658e86c8c","correlationId":"c6eeecc9-2594-41d1-ba9e-1fad422112c7"}
{"name":"gather","ts":"2026-11-22T08:16:45.652Z","type":"STEP_COMPLETED","runId":"run_2c0be60c-db38-4d93-bb6d-348658e86c8c","correlationId":"c6eeecc9-2594-41d1-ba9e-1fad422112c7"}
{"name":"reconcile","ts":"2026-11-22T08:16:45.654Z","type":"STEP_COMPLETED","runId":"run_2c0be60c-db38-4d93-bb6d-348658e86c8c","correlationId":"c6eeecc9-2594-41d1-ba9e-1fad422112c7"}
$ kill -9 15340
$ ap get run_2c0be60c-db38-4d93-bb6d-348658e86c8c | jq '{runId,status,currentStep,budget}'
{
  "runId": "run_2c0be60c-db38-4d93-bb6d-348658e86c8c",
  "status": "RUNNING",
  "currentStep": "reconcile",
  "budget": {
    "steps": "4 of 20",
    "toolCalls": "7 of 15",
    "modelCalls": "2 of 6"
  }
}
$ ap resume run_2c0be60c-db38-4d93-bb6d-348658e86c8c | jq '{runId,status,currentStep,budget}'
{
  "runId": "run_2c0be60c-db38-4d93-bb6d-348658e86c8c",
  "status": "AWAITING_APPROVAL",
  "currentStep": "request_approval",
  "budget": {
    "steps": "6 of 20",
    "toolCalls": "7 of 15",
    "modelCalls": "3 of 6"
  }
}
```
