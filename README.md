# SPXI-gnΩsis

Opens pinned Wikipedia revisions: each claim read against the sources it cites and the sources its article cites elsewhere, under the policy texts it was written against, with the result kept as evidence. Billable to agents over x402 and to people by card.

The reading step (S3) follows EA-WIKI-OPEN-01 v1.1 ([#1697](https://www.alexanarch.org/s/records/1697/)), protocol `gnosis-S3/0.5`: the innocent reading first; uncited sentences read against the article's other sources; a gloss tested as a reading; ambiguous phrases divided; entailment held to predicate, unit and function; three measures kept apart (source fidelity, primary-text adequacy, operative retention); retained authority as retained, lost, mixed or unknown; and the five-part account. The invitation codes and the two-arm check of §6.3 (c) are recorded and never counted toward a verdict until a round on fixed cases has scored them (§9.7). Every quotation is checked against the full source, and a quotation from outside the passages sent is recorded as its own breach.

- Service: https://gnosis.spxi.dev (planned)
- Protocol home: https://spxi.dev
- Archive: https://www.alexanarch.org

`npm install`, then `npm start` (port 4402). Keys are read from the environment; see `src/payments.js` and `src/reader.js`. `store/` holds the pinned policy texts and calibration replays the reader uses; runtime records (quotes, receipts, results) are written there and are not tracked.

Licensed under the PolyForm Shield License 1.0.0. See `LICENSE.md`.
