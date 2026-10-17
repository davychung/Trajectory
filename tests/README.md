# Import and persistence verification

From the `trajectory` directory, run:

```powershell
node tests/trajectory-data.test.js
```

No packages or installation are required. If Node is not on PATH, pass the full
path to an existing Node executable. The tests use built-in `assert`, `vm`, `fs`,
and `path`. They load the actual application script in isolated contexts with a
small DOM double and controllable storage. They never access real browser history.

Coverage includes complete-file validation, typed recursive comparison, both kinds
of duplicate IDs, historical records, unchanged scoring, and all four application
mutation paths (add, delete, reset, import). Each mutation is tested for write-before-
state ordering, failed reads/writes, and successful saving followed by failed
rendering, including reload and export. File reading and stale previews are tested
as well. DOM doubles do not verify visual layout or native download/picker behavior.

Regression coverage also rejects unsafe integer IDs before duplicate merging and
non-finite numbers throughout event extensions. Corrupt stored records must remain
unchanged and downloadable in recovery mode. Import failures are checked in the
local preview, including safe retries after temporary read/write failures. Repeated
file selection tests check that the input is cleared while retaining the candidate.

## Manual browser verification

Use a separate browser profile or disposable local origin. Export any real history
first. Use the existing Live Server setup, or another already available static
server; no application dependencies are needed. Keep the same origin for reloads.

1. Log two activities and export them. Inspect the original five export fields:
   `exportVersion`, `rulesetVersion`, `exportedAt`, `activityRules`, `events`.
2. Select that export with Import Data. The preview should report two identical
   duplicates and disable Confirm Merge. Storage should not change.
3. Make a copy of the export with a new, unique numeric event ID. Select it and
   verify that existing history does not change until Confirm Merge. First cancel,
   then select it again and confirm. Reload: the new event should remain. Import
   the same file again: it should be a no-op.
4. In another copy, change a description but keep its existing ID. Confirm Merge
   should be disabled and the conflicting ID listed. Repeat with two different
   records sharing one new ID within the file.
5. Try truncated JSON and a file containing one valid event plus one with invalid
   hours. Both should be rejected completely, with no saved history changes.
6. Give a new event `rulesetVersion: 99`, or remove its version, or use an unknown
   activity type. Import it. It should show "Evaluation unavailable" and still
   count toward factual activity/hour totals. Reload and export: its fields,
   including any nested extension fields, must remain intact. It receives no XP.
7. Open a second tab on the same origin. Preview an import in the first, add an
   event in the second, then confirm in the first. It must rebuild the preview
   and require another confirmation, preserving the second tab's event.
8. After importing successfully, reset the disposable history and choose the same
   file again. A fresh preview should appear. Select a rejected file twice as well:
   both attempts should show the rejection. The picker clears its selection after
   each change so the same file path can trigger a new attempt.
9. Try a file with an event ID above `Number.MAX_SAFE_INTEGER`, or an event extension
   containing the numeric token `1e400` (not a quoted string). Reject the whole file
   with an event/field error. No IDs should be reassigned or values changed to null.

### Failure injection (disposable profile/origin only)

For a write failure, run this in DevTools, then try add, delete, reset, and import:

```javascript
window.originalSetItem = Storage.prototype.setItem;
Storage.prototype.setItem = function () {
    throw new DOMException("Simulated quota failure", "QuotaExceededError");
};
```

Each action should report that nothing changed. Restore writes with
`Storage.prototype.setItem = window.originalSetItem`, or reload. Retry the import
confirmation: the selected candidate should still be available.
Import failures should appear directly in the preview as "Import not saved" with
"Save failed" status. Confirmation stays available for a safe retry. If stored data
becomes corrupt before confirmation, the preview should require recovery instead,
disable confirmation, and expose the unchanged raw data for download.

For a render failure after saving:

```javascript
window.originalRestore = restoreCareerEvents;
restoreCareerEvents = function () { throw new Error("Simulated render failure"); };
```

Add an activity or confirm an import. The message must say history **was saved**
and the display failed. Export immediately or reload: the saved event must remain.
Reload restores the original rendering function.

For corrupt-storage recovery, save the original raw value outside the application
before deliberately corrupting the disposable origin:

```javascript
window.originalRaw = localStorage.getItem("trajectoryEvents");
// Copy originalRaw into a separate text file before continuing; reload clears it.
localStorage.setItem("trajectoryEvents", "{broken");
```

Reload. The application must report blocked changes and show Download Recovery
Data. Its downloaded text must be exactly `{broken`. Add/delete/reset/import must
not replace that value. Export Data should also download the raw recovery value.
Repair storage from your saved original value or export using DevTools, then reload.
Raw recovery downloads require manual repair; they are not automatically imported.

## Remaining boundaries

- Storage remains a bare event array; no automatic migration, cleanup, or deletion.
- Export metadata is shown during import, not persisted; keep original export files
  for their historical rule snapshots. Exports use the unchanged current format.
- Conflicting IDs require manual file repair. No replacement or ID-rewriting mode.
- Unsupported records are preserved but not evaluated using imported rules.
- Cross-tab checks detect changes before writing; localStorage has no atomic
  compare-and-swap, so simultaneous writes can still race.
- Very large files are read into memory and history is fully rerendered.
- Storage writes are synchronous; successful writes do not protect against later
  browser data clearing, disk failure, or removal of the browser profile.
