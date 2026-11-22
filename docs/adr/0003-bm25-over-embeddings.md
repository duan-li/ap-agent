# Use local section retrieval

Chunk on section headings, filter trust and effective windows, then rank lexically with BM25. Return the versioned section ID.

## Context

The supplied corpus is small, versioned and assessed against exact policy sections. A hosted embedding index would bring a network and credential dependency to offline acceptance.

## Consequences

The answer key can be replayed without an embedding model. Paraphrases and exceptions split across headings remain weaknesses.
