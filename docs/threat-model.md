# Threat model

The protected assets are the approved financial decision, the vendor master, account details and the evidence explaining each write.

| Threat and entry point | Control and verification | Remaining boundary |
| --- | --- | --- |
| A supplier embeds approval instructions or invents a policy | The trust allowlist controls policy citations. Rules consume typed observations. FIN-003 and RL-004 exercise a fooled model and a forged approval ID. | The pattern-based signal extractor covers the supplied texts. Novel fraud language needs evaluation. |
| Someone claims an approver identity | Role, register and gross limit must authorise the pending snapshot. FIN-001-wrong-approver exercises a refused actor. | The CLI flag simulates identity. Production needs authenticated transport and verified actor binding. |
| Callback replay or concurrent workers | Inbox hash, conditional approval update, fenced lease, unique outbox and ERP keys. FIN-005 and the lease tests count effective decisions. | A real receiver must honour the key and provide reliable lookups. |
| Vendor or policy changes during review | Recheck the vendor and authority before first send. Record a found receipt before auditing a subsequent change. | Remaining real-world race conditions require conditional ERP writes or equivalent receiver-side controls. |
| Account or credential disclosure | Mask fixture accounts in tool data, persisted events and output. RL-003 scans four surfaces. The Docker context excludes local secrets. | Local files require host access controls. The fixtures are synthetic and must stay separate from production data. |
| Model invents a financial claim | Validate extraction and its supporting quote, limit repair and check explanation citations and numbers. | A real quote can still be misinterpreted. Model evaluation on representative invoices remains necessary. |
