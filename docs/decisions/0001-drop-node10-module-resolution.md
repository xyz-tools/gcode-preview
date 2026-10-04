# Drop node10 module resolution

**What:** TypeScript consumers must use `bundler`, `node16` or `nodenext`
module resolution. Legacy `moduleResolution: "node"` (node10) is no longer
tested or supported.

**Why:** TypeScript 6 deprecates node10 and TypeScript 7 removes it, so
supporting it means maintaining something that will stop working anyway.

**Impact:** Consumers still on `"node"` should switch: `bundler` for frontend
apps, `node16`/`nodenext` for Node. The root import still resolves via
`types` today, but nothing guarantees it keeps working. The packaging test no
longer covers node10, and our own tsconfig moved to `bundler`.
