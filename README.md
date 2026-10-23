# SPXI-gnΩsis

Opens pinned Wikipedia revisions: each claim read against the sources it cites and the sources its article cites elsewhere, under the policy texts it was written against, with the result kept as evidence. Billable to agents over x402 and to people by card.

The reading step (S3) follows EA-WIKI-OPEN-01 v1.1 ([#1697](https://www.alexanarch.org/s/records/1697/)), protocol `gnosis-S3/0.6`: the innocent reading first; uncited sentences read against the article's other sources; a gloss tested as a reading; ambiguous phrases divided; entailment held to predicate, unit and function; three measures kept apart (source fidelity, primary-text adequacy, operative retention); retained authority as retained, lost, mixed or unknown; and the five-part account. The invitation codes and the two-arm check of §6.3 (c) are recorded and never counted toward a verdict until a round on fixed cases has scored them (§9.7). Every quotation is checked against the full source, and a quotation from outside the passages sent is recorded as its own breach. The second of the two passes is an independent reading that returns only the fields the passes are reconciled on; the full account is the first pass's.

Two tiers (0.11.0):

- **Opening.** Sentences opened against their own sources and the article's, at the point of contact (`GET /v1/sentence`) or a whole revision at a time. The archive is not consulted. Priced in cents: a sentence lists at $0.05 (raised only where long sources put the estimate times 1.5 above it), a preliminary single pass at $0.01, a sentence already in the ledger at $0.01.
- **Commission.** The opening, with the Crimson Hexagonal Archive consulted by its own procedure: the archive's claims aligned to each sentence and the entity's /non row composed (public). Priced from the traversal it would run. `portable` adds the entity's knowledge object as a package. An entity the encyclopedia does not hold is always a commission.
- **Grounded sentences.** Once an article has been commissioned, any sentence its /non row holds can be asked for with `mode=grounded`: the opening, with the archive's claims on that sentence from the row's alignment, at two cents over the sentence's price (two cents alone where the reading is already in the ledger). The row's archive release is disclosed beside the current one. Where no commissioned row holds the sentence, the commission is offered and nothing is charged; S7 never runs for one sentence.

- Service: https://gnosis.spxi.dev (planned)
- Protocol home: https://spxi.dev
- Archive: https://www.alexanarch.org

`npm install`, then `npm start` (port 4402). Keys are read from the environment; see `src/payments.js` and `src/reader.js`. `store/` holds the pinned policy texts and calibration replays the reader uses; runtime records (quotes, receipts, results) are written there and are not tracked.

Licensed under the PolyForm Shield License 1.0.0. See `LICENSE.md`.
