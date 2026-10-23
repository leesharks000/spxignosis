# SPXI-gnΩsis

Opens pinned Wikipedia revisions: each claim read against the sources the revision cites, under the policy texts it was written against, with the result kept as evidence. Billable to agents over x402 and to people by card.

- Service: https://gnosis.spxi.dev (planned)
- Protocol home: https://spxi.dev
- Archive: https://www.alexanarch.org

`npm install`, then `npm start` (port 4402). Keys are read from the environment; see `src/payments.js` and `src/reader.js`. `store/` holds the pinned policy texts and calibration replays the reader uses; runtime records (quotes, receipts, results) are written there and are not tracked.

Licensed under the PolyForm Shield License 1.0.0. See `LICENSE.md`.
