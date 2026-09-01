# Byte-backed components: integer entity handles + SoA columns

> **Status: DONE, 2026-09-02, branch `soa-rewrite`.** All phases landed; results below.
>
> Phase 0 gate (`bench/soaGate.bench.ts`): current LocalToWorldSystem 1.305 ms/frame median
> vs hand-written SoA 0.064 ms (archetype-honest) and 0.299 ms (per-entity rot/scale
> columns) — **4.36x on the conservative variant**, 20x honest, exact float parity → GO.
>
> ## Measured results per phase (boundsCascade N=40k "moving", medians of 3)
>
> | stage | LocalToWorldSystem | frame total (l2w+wsb+pass) |
> |---|---|---|
> | baseline (pre-rewrite) | 1.53-2.04 ms | ~9.7 ms |
> | Phase 1 (integer handles) | 1.40 ms | no change (noise) |
> | Phase 2 (columns, object API on top) | 1.00 ms | — |
> | Phase 4 (systems on consumeSpans) | **0.53 ms** | **~2.1 ms** |
>
> WorldSpaceRenderBoundsCompute 0.12 ms; Console2DRenderPass index 3.37 → 1.41 ms (the
> zHeight `.position` subarray mint per entity was the culprit). `soaGate` parity maxErr = 0.
> scriptc: 88% static (90/102) vs 87% (123/141) before — fewer statements because Phase 1
> deleted the DoubleMap/Symbol machinery. Regression net green throughout: 127 tests (was
> 111), typecheck, build, verifyWorld (0-byte static frame), verifyThreading 60/60.
> (tests/verifyParity.ts was already broken before this work — the frozen `_legacy` snapshot
> calls `Vec.div`, removed by the earlier Vec API rewrite.)
>
> ## What shipped, in brief
>
> - **Phase 1** — `Entity` is a branded 32-bit integer (20-bit index, 12-bit generation);
>   ownership/row/name live in parallel side tables in `ownership.ts`; stale handles are
>   rejected by generation check. The brand is an **ambient enum**, not a symbol
>   intersection — the intersection form cost scriptc every Entity-touching signature.
> - **Phase 2** — components declaring `static f32Width = N` + implementing `F32Backed`
>   (componentType.ts) store floats in one dense Float32Array column per archetype;
>   instances persist as *views* into the column, rebound on every row move (swap-remove,
>   enable/disable, growth, archetype moves via detach/re-attach). Long-lived tracked
>   handles from `addTrackedComponent` stay valid — pinned in `core/soaStorage.test.ts`.
>   Converted: LocalPosition/Scale(3), LocalRotation(4), LocalToWorld/ParentTransform(16),
>   RenderBounds/WorldSpaceRenderBounds(6). Strings/refs stay object-backed as planned.
> - **Phase 3** — `EntityQueryStream.consumeSpans()`: one reused span per dirty block with
>   raw columns (`cols.<key>`), stores for object-backed types, dense entity handles, and
>   [start, end). Block filtering / write stamps / `Unchanged` (per span) as in consume().
> - **Phase 4** — LocalToWorldSystem (via `LocalToWorld.fromTRSAt`/`mulAt`),
>   WorldSpaceRenderBoundsCompute, RenderMeshBounds, ParentTransformSync (child columns
>   stamped per block instead of whole-column proxy stamps), RenderBounds2DApplyModifier,
>   and the Console2DRenderPass index loop.
>
> It exists because this idea has now been explored twice from scratch (once ending in commit
> `46b8ef0`, which reverted it). Read the Context section and run the Phase 0 gate before
> re-exploring it a third time.

## Context

The question that prompted this: *"is there a way to force all components to have bytearray
backing?"*

Today you cannot. Of 17 components, 8 are already `Float32Array`-backed and 4 are
one-to-three-number scalars, but **3 hold object references** (`Parent`→`Entity`,
`Children`→`Entity[]`, `RenderMesh`→`Mesh`) and **2 hold strings** (`ConsoleImage`,
`ConsoleImageAnchor`). The reference ones are the real blocker: `Entity` is `class Entity {}` —
pure object identity — and both ownership and the debug name are stored as **Symbol properties
on the entity object itself** (`ownership.ts`'s `OWNER`, `symbols.ts`'s `NAME`), with
archetypes indexing through `DoubleMap<Entity, number>`. Nothing can be encoded as an integer
until entities are integers.

So "all components byte-backed" is downstream of a foundational change: integer entity handles
plus per-field SoA columns. That is what this plan covers.

Note the honest end state is **"every *numeric* component byte-backed"**, not literally all of
them — see the escape hatches in Phase 2.

### This was attempted before and reverted

Commit `46b8ef0` — *"ditched custom memory layout in favor of many smaller float/intarrays
(more performant and simpler)"* — deleted ~1,500 lines (`memory.ts`, `heap.ts`, `pools.ts`,
`pointer.ts`, `doubleStack.ts`). The benchmark record from that era says arena-backed component
fields measured **12.8x slower**, because JSC optimises a small freshly-allocated typed array
at a *literal* index harder than anything else — exactly what `LocalPosition` already does.

### But that evidence is weaker than it looks, and the counter-evidence is in this repo

The 12.8x and the oft-quoted "~19% SoA ceiling" both came from a **synthetic field-access
loop**. `ItemStore` (`src/js_engine/datatypes/spatial/itemStore.ts`) carries a **real-workload**
measurement in its own header, on the intersect test at 100k boxes:

```
plain objects      142.1 us
subarray views     139.9 us
flat interleaved    93.7 us
six SoA columns     74.2 us      <- 1.9x over plain objects
```

That is the same transformation this plan proposes, already done once in this codebase, and it
won by 1.9x.

The two results reconcile cleanly: the old arena lost because it handed out **per-element
objects with `.x`/`.y` accessor getters**; `ItemStore` wins because callers touch columns
directly.

> **The design constraint that decides this rewrite: never hand a system a per-entity object
> with accessors.** This is why `entityQueryStream.ts` (Phase 3), not the storage layer, is the
> make-or-break file.

Because the evidence genuinely points both ways, Phase 0 is a hard measurement gate.

## Phase 0 — the gate (do this first, in isolation)

Extend `bench/queryApi.bench.ts`, which already exists to compare query-API shapes and already
benchmarks the current "plain row object + `trackComponent()` Proxy" path. Add a hand-written
SoA variant of the **`LocalToWorldSystem` workload** — read `LocalPosition`, optional
`LocalRotation`/`LocalScale`, write `LocalToWorld` — over raw parallel `Float32Array` columns
with the columns hoisted into locals, no per-entity object at any point.

Compare against the real current cost: `LocalToWorldSystem` is **1.53 ms/frame median**
(`bench/boundsCascade.bench.ts`, N=40000, "moving" column; interleave variants and take
medians — that bench is noisy, single runs range 1.47–2.55).

| result | action |
|---|---|
| **>= 1.5x faster** | proceed to Phase 1; consistent with `ItemStore`'s 1.9x |
| **1.25x – 1.5x** | stop and report; not worth a foundational rewrite |
| **< 1.25x** | stop; that is the synthetic-ceiling result and confirms `46b8ef0` |

Phase 0 is throwaway benchmark code. Nothing in `src/` changes, so a "stop" outcome costs
nothing and settles the question permanently.

## Phase 1 — integer entity handles

Independently valuable (it also removes scriptc's top blockers — object-keyed `Map`s and
`WeakRef`/`WeakMap`) and shippable on its own.

- `core/entity.ts`: `Entity` becomes a branded integer — index in the low bits, **generation
  counter** in the high bits, so a stale handle to a destroyed-and-recycled slot is detectable
  rather than silently aliasing a new entity. Keep it a nominal/branded type so a raw `number`
  is still a compile error (same technique as `Vec`/`AABB` in `math/types/vec.ts`).
- `core/ownership.ts`: replace the `(entity as any)[OWNER]` Symbol property with a side table
  indexed by entity index — a dense array of `{world, arch}` plus an `Int32Array` of
  generations. Keep the exported signatures (`getOwner`, `getOwnerInferred`, `setOwner`,
  `requireOwner`) so call sites do not move.
- `core/symbols.ts` / `NAME`: debug names move to a side `string[]` on the World, indexed the
  same way.
- `core/entityArchetype.ts`: `_entities: DoubleMap<Entity, number>` becomes a dense
  `Int32Array` of entity indices plus a sparse index array — the classic sparse-set. Copy
  `ItemStore`'s free-list discipline for slot recycling.
- `core/entityManager.ts`: `createEntity`/`realizeEntity`/`destroyEntity` allocate and recycle
  handles, bumping generation on destroy.

## Phase 2 — component schemas and SoA columns

- Add a schema declaration to `componentType.ts`: each component type declares its fields and
  types (`f32`, `i32`, `entity`, `ref`). Model the storage on `ItemStore` — **separate column
  per field, not one interleaved buffer**; its header documents interleaved at 93.7 vs split at
  74.2 on the same data.
- `core/entityArchetype.ts`: `ComponentStore._componentData: ComponentOf<CT>[]` becomes one
  typed array per declared field. **The block change-tracking must survive intact** —
  `BLOCK_SHIFT`/`BLOCK_SIZE` and `_blockTimes` are what make `filterLastUpdated` work, and that
  file documents a still scene at 41 ms/frame vs ~196 ms under churn without it. This is the
  highest-risk part of the migration; port it before touching storage.
- Escape hatches, since not everything is bytes:
  - `entity` fields → `Int32Array` of handles (now possible; `Children` becomes an `Int32Array`
    with the swap-remove it already has).
  - `ref` fields (`RenderMesh.mesh`) → an index into a per-World asset registry, keeping the
    object side table out of the hot column.
  - strings (`ConsoleImage`, `ConsoleImageAnchor`) → **stay object-backed**. The console
    renderer's domain is ANSI strings; declare these explicitly exempt rather than forcing a
    string table.

## Phase 3 — column-based query API

`core/entityQueryStream.ts` is where the design constraint bites. `consume()` already reuses one
row object; the SoA form must go further and hand the callback **column references plus an
index**, never a per-entity object with `.x`/`.y` getters — that accessor shape is what made the
old arena 9-13x slower. Keep the `read`/`write`/`optional` intent and the `Unchanged` opt-out.

## Phase 4 — migrate systems

Mechanical once Phase 3 lands. `LocalToWorldSystem` first (hottest, already benchmarked), then
`ParentTransformSyncSystem`, `HierarchySyncSystem`, `worldSpaceRenderBoundsComputeSystem`,
`renderMeshBoundsSystem`, the render passes.

## Verification

- **Phase 0 gate**: `bun bench/queryApi.bench.ts` and `bun bench/boundsCascade.bench.ts`,
  interleaved variants, medians of >= 3 runs.
- **Regression net, must stay green at every phase**:
  - `npm run typecheck`
  - `bun test` — 111 tests. `core.test.ts` pins archetype/tracking behaviour,
    `translation.test.ts` pins the transform hierarchy, `consoleImage.test.ts` pins the glyph
    grid.
  - `bun tests/verifyWorld.ts` — asserts static frames write **0 bytes**, which is exactly what
    breaks if block change tracking regresses in Phase 2.
  - `bun tests/verifyThreading.ts` — 60/60 identical frames.
- **Per-phase**: re-run `boundsCascade` and record medians in this document as you go, so a
  regression is attributed to the phase that caused it rather than discovered at the end.
- Phase 1 needs new tests for handle recycling: destroy an entity, create another, confirm the
  stale handle is rejected via the generation counter rather than resolving to the new entity.

## Risks and stop conditions

- **Stop if Phase 0 misses the bar.** That is the entire point of running it first.
- Block change tracking is the subtle failure: it will not surface as a test failure so much as
  a frame-time regression plus `verifyWorld`'s zero-byte assertion breaking. Port it first.
- Generation counters are the difference between a stale handle being caught and silently
  reading another entity's data. Do not defer them.
- Improving scriptc coverage is a *side effect* of Phase 1, not a justification for it.
