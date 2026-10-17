"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const data = require("../trajectory-data.js");
const source = fs.readFileSync(path.join(__dirname, "../trajectory.js"), "utf8");
const rules = { learning: {}, other: {} };
const event = (id = 1, extra = {}) => ({ id, activityType: "learning", activityLabel: null,
    measurements: { hours: 2 }, description: "Learned JavaScript", source: "manual",
    timestamp: "2026-10-18T00:00:00.000Z", rulesetVersion: 1, ...extra });
const envelope = events => data.buildTrajectoryExport(events, rules, 1, "2026-10-18T01:00:00.000Z");
const clone = value => JSON.parse(JSON.stringify(value));
const tests = [];
const test = (name, run) => tests.push({ name, run });

function browser(initial = [event()], options = {}) {
    let raw = options.raw !== undefined ? options.raw : JSON.stringify(initial);
    const elements = new Map();
    const blobs = [];
    const control = { failWrite: false, failRead: false, confirmation: true, writes: 0, beforeWrite: null };
    const storage = {
        getItem() { if (control.failRead) throw new Error("Blocked read"); return raw; },
        setItem(key, value) {
            if (control.beforeWrite) control.beforeWrite();
            if (control.failWrite) throw new Error("Quota exceeded");
            raw = value;
            control.writes++;
        }
    };
    function element() {
        return { textContent: "", value: "", hidden: false, disabled: false, files: [], children: [], handlers: {},
            classList: { toggle() {}, remove() {} },
            addEventListener(name, callback) { this.handlers[name] = callback; },
            append(...children) { this.children.push(...children); },
            appendChild(child) { this.children.push(child); },
            prepend(child) { this.children.unshift(child); },
            scrollIntoView(options) { this.scrollOptions = options; },
            reset() {}, click() {}, remove() {} };
    }
    const context = vm.createContext({
        TrajectoryData: data, console: { log() {} },
        window: { get localStorage() { if (options.blockStorageAccess) throw new Error("Denied"); return storage; }, confirm: () => control.confirmation },
        document: { getElementById(id) {
                if (!elements.has(id)) {
                    const node = element();
                    node.hidden = ["custom-type-field", "import-preview", "recovery-data-button"].includes(id);
                    elements.set(id, node);
                }
                return elements.get(id);
            },
            createElement: element, body: element() },
        Blob: class { constructor(parts) { blobs.push(parts.join("")); } },
        URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} }
    });
    vm.runInContext(source, context);
    return { context, control, elements, blobs, storage,
        run: code => vm.runInContext(code, context),
        history: () => JSON.parse(vm.runInContext("JSON.stringify(careerEvents)", context)),
        raw: () => raw, setRaw: value => { raw = value; },
        message: () => elements.get("form-message").textContent };
}

test("existing export shape and supported events round trip", () => {
    const exported = envelope([event()]);
    assert.deepEqual(data.parseTrajectoryExport(JSON.stringify(exported), rules, 1), exported);
    assert.deepEqual(Object.keys(exported), ["exportVersion", "rulesetVersion", "exportedAt", "activityRules", "events"]);
});
test("classification distinguishes all three categories", () => {
    assert.equal(data.classifyCareerEvent(event(), rules, 1).category, "evaluable");
    assert.equal(data.classifyCareerEvent(event(1, { rulesetVersion: 2 }), rules, 1).category, "unsupported");
    assert.equal(data.classifyCareerEvent(event(1, { measurements: { hours: "2" } }), rules, 1).category, "malformed");
});
test("missing version is unsupported and never invented", () => {
    const historical = event(); delete historical.rulesetVersion;
    assert.equal(data.classifyCareerEvent(historical, rules, 1).category, "unsupported");
    assert.equal(Object.hasOwn(historical, "rulesetVersion"), false);
});
test("unknown types and sources with nested extension fields are preserved", () => {
    const historical = event(2, { activityType: "mentoring", source: "legacy", extra: { flags: [false, null, 2] } });
    const parsed = data.parseTrajectoryExport(JSON.stringify(envelope([historical])), rules, 1);
    assert.deepEqual(parsed.events[0], historical);
    assert.equal(data.isEvaluableCareerEvent(historical, rules, 1), false);
});
for (const [name, contents] of [
    ["invalid JSON", "{"], ["null envelope", "null"],
    ["unknown export version", JSON.stringify({ ...envelope([]), exportVersion: 2 })],
    ["missing rules snapshot", JSON.stringify({ ...envelope([]), activityRules: null })],
    ["invalid export date", JSON.stringify({ ...envelope([]), exportedAt: "invalid" })],
    ["invalid envelope rules version", JSON.stringify({ ...envelope([]), rulesetVersion: 0 })],
    ["non-array events", JSON.stringify({ ...envelope([]), events: {} })]
]) test(`rejects ${name}`, () => assert.throws(() => data.parseTrajectoryExport(contents, rules, 1)));

for (const [field, value] of [["id", "1"], ["measurements", []], ["measurements", { hours: 25 }],
    ["measurements", { hours: 0 }], ["description", " "], ["source", ""], ["timestamp", "bad"],
    ["rulesetVersion", null], ["rulesetVersion", 1.5], ["activityType", ""]]) {
    test(`rejects malformed ${field}: ${JSON.stringify(value)}`, () => {
        assert.throws(() => data.parseTrajectoryExport(JSON.stringify(envelope([event(), event(2, { [field]: value })])), rules, 1), /Event 2:/);
    });
}
test("other requires a custom label", () => {
    assert.equal(data.classifyCareerEvent(event(1, { activityType: "other" }), rules, 1).category, "malformed");
    assert.equal(data.classifyCareerEvent(event(1, { activityType: "other", activityLabel: "Portfolio" }), rules, 1).category, "evaluable");
});
test("deep equality ignores object order at every depth", () => {
    assert.equal(data.recordsEqual({ a: [{ x: 1, y: null }], b: false }, { b: false, a: [{ y: null, x: 1 }] }), true);
});
test("deep equality preserves types, nesting, array order and array/object distinction", () => {
    for (const [a, b] of [[1, "1"], [null, {}], [false, 0], [[1, 2], [2, 1]],
        [[1], { 0: 1 }], [{ a: [] }, { a: {} }], [{ a: null }, {}], [[1], [1, 2]]]) {
        assert.equal(data.recordsEqual(a, b), false);
    }
});
test("duplicate comparison handles property names such as __proto__", () => {
    assert.equal(data.recordsEqual(JSON.parse('{"__proto__":{"x":1}}'), JSON.parse('{"__proto__":{"x":2}}')), false);
});
test("identical duplicates within file and history are skipped", () => {
    const result = data.prepareEventMerge([event()], [clone(event()), event(2), clone(event(2))], rules, 1);
    assert.equal(result.duplicates, 2); assert.equal(result.added, 1);
    assert.deepEqual(result.events.map(item => item.id), [2, 1]);
});
test("different contents for the same ID conflict within the file and against history", () => {
    const result = data.prepareEventMerge([event()], [event(1, { source: "import" }), event(2), event(2, { description: "Changed" })], rules, 1);
    assert.deepEqual(result.conflicts, [1, 2]);
});
test("different IDs with the same facts remain separate", () => {
    assert.equal(data.prepareEventMerge([event()], [event(2)], rules, 1).added, 1);
});
test("merge does not mutate either input", () => {
    const existing = [event()], incoming = [event(2)];
    const before = JSON.stringify([existing, incoming]);
    data.prepareEventMerge(existing, incoming, rules, 1);
    assert.equal(JSON.stringify([existing, incoming]), before);
});

function prepareImport(app, events = [event(2)]) {
    app.context.importedFixture = envelope(events);
    app.run("renderImportPreview(importedFixture)");
}
const mutationPaths = {
    add: app => app.run(`addCareerEvent(${JSON.stringify(event(2))})`),
    delete: app => app.run("deleteCareerEvent(1)"),
    reset: app => app.run("resetCareerEvents()"),
    import: app => { prepareImport(app); return app.run("confirmImport()"); }
};
for (const [name, mutate] of Object.entries(mutationPaths)) {
    test(`${name}: failed write leaves memory and storage unchanged`, () => {
        const app = browser(), before = app.raw();
        app.control.failWrite = true;
        assert.equal(mutate(app), false);
        assert.equal(app.raw(), before); assert.deepEqual(app.history(), [event()]);
        assert.equal(app.control.writes, 0); assert.match(app.message(), /Could not save/);
    });
    test(`${name}: storage is written before memory changes`, () => {
        const app = browser();
        app.control.beforeWrite = () => assert.deepEqual(app.history(), [event()]);
        assert.equal(mutate(app), true);
        assert.equal(app.control.writes, 1);
        assert.deepEqual(JSON.parse(app.raw()), app.history());
        assert.equal(app.history().length, name === "add" || name === "import" ? 2 : 0);
    });
    test(`${name}: saved records survive a render failure and reload`, () => {
        const app = browser();
        app.run('restoreCareerEvents = function() { throw new Error("Display failed"); }');
        assert.equal(mutate(app), true);
        assert.match(app.message(), /History was saved/);
        assert.doesNotMatch(app.message(), /rolled back|Nothing was changed/);
        const reloaded = browser([], { raw: app.raw() });
        assert.deepEqual(reloaded.history(), app.history());
        app.run("exportCareerEvents()");
        assert.deepEqual(JSON.parse(app.blobs.at(-1)).events, app.history());
    });
    test(`${name}: read failure blocks mutation`, () => {
        const app = browser(), before = app.raw();
        app.control.failRead = true;
        assert.equal(mutate(app), false);
        assert.equal(app.raw(), before); assert.deepEqual(app.history(), [event()]);
    });
}
test("serialization failure leaves storage and memory unchanged", () => {
    const app = browser(), before = app.raw();
    app.context.cyclic = event(2); app.context.cyclic.extension = app.context.cyclic;
    assert.equal(app.run("addCareerEvent(cyclic)"), false);
    assert.equal(app.raw(), before); assert.deepEqual(app.history(), [event()]);
});
test("delete and reset cancellations do not write", () => {
    const app = browser(); app.control.confirmation = false;
    app.run("deleteCareerEvent(1); resetCareerEvents()");
    assert.equal(app.control.writes, 0); assert.deepEqual(app.history(), [event()]);
});
test("add rejects a duplicate ID", () => {
    const app = browser(); assert.equal(app.run(`addCareerEvent(${JSON.stringify(event())})`), false);
    assert.equal(app.control.writes, 0);
});
test("conflicting import is blocked without writing", () => {
    const app = browser(); prepareImport(app, [event(1, { description: "Conflict" })]);
    assert.equal(app.elements.get("confirm-import-button").disabled, true);
    assert.equal(app.run("confirmImport()"), false); assert.equal(app.control.writes, 0);
});
test("import waits for confirmation and cancel discards pending candidate", () => {
    const app = browser(); prepareImport(app);
    assert.deepEqual(app.history(), [event()]); assert.equal(app.control.writes, 0);
    app.elements.get("cancel-import-button").handlers.click();
    assert.equal(app.run("confirmImport()"), false); assert.equal(app.control.writes, 0);
});
test("repeated import is a no-op", () => {
    const app = browser(); mutationPaths.import(app);
    prepareImport(app); assert.equal(app.run("confirmImport()"), false);
    assert.equal(app.control.writes, 1);
});
test("historical records survive startup, import, export and reload without evaluation", () => {
    const missingVersion = event(2); delete missingVersion.rulesetVersion;
    const historical = [missingVersion, event(3, { activityType: "future-type", source: "old-system", extra: { nested: [null, false, "1"] } }), event(4, { rulesetVersion: 9 })];
    const app = browser(historical);
    assert.equal(app.control.writes, 0); assert.deepEqual(app.history(), historical);
    assert.equal(app.run("totalXP"), 0); assert.equal(app.elements.get("total-hours").textContent, 6);
    assert.match(app.elements.get("activity-list").children[0].children[0].textContent, /Evaluation unavailable/);
    prepareImport(app, [event(5, { rulesetVersion: 8 })]); app.run("confirmImport()");
    app.run("exportCareerEvents()");
    const exported = JSON.parse(app.blobs.at(-1));
    assert.deepEqual(exported.events, [event(5, { rulesetVersion: 8 }), ...historical]);
    const reload = browser([], { raw: app.raw() });
    assert.deepEqual(reload.history(), exported.events); assert.equal(reload.run("totalXP"), 0);
});
test("supported scoring and newest-first history remain unchanged", () => {
    const app = browser([event(2, { activityType: "project-work" }), event()]);
    assert.equal(app.run("totalXP"), 100);
    assert.equal(app.run("dimensionXP.building"), 36);
    assert.equal(app.elements.get("activity-list").children[0].children[0].textContent.includes("Project Work"), true);
});
for (const [name, raw] of [["invalid JSON", "{"], ["wrong shape", "{}"], ["malformed stored event", JSON.stringify([event(1, { description: "" })])],
    ["duplicate stored IDs", JSON.stringify([event(), event()])]]) {
    test(`startup ${name} preserves raw data, blocks all mutations and allows recovery`, () => {
        const app = browser([], { raw });
        assert.equal(app.control.writes, 0); assert.equal(app.raw(), raw);
        for (const mutate of Object.values(mutationPaths)) {
            if (mutate === mutationPaths.import) continue;
            mutate(app);
        }
        app.run("confirmImport()");
        assert.equal(app.raw(), raw); assert.equal(app.control.writes, 0);
        app.run("downloadRecoveryData()"); assert.equal(app.blobs.at(-1), raw);
        app.run("exportCareerEvents()"); assert.equal(app.blobs.at(-1), raw);
    });
}
test("storage getter failure blocks startup and mutations without crashing", () => {
    const app = browser([], { blockStorageAccess: true });
    assert.match(app.message(), /Changes are blocked/);
    assert.equal(mutationPaths.add(app), false); assert.equal(app.control.writes, 0);
});
test("missing storage loads empty without writing", () => {
    const app = browser([], { raw: null }); assert.deepEqual(app.history(), []); assert.equal(app.control.writes, 0);
});
test("stale import preview is rebuilt and requires confirmation again", () => {
    const app = browser(); prepareImport(app);
    app.setRaw(JSON.stringify([event(3), event()]));
    assert.equal(app.run("confirmImport()"), false); assert.equal(app.control.writes, 0);
    assert.match(app.message(), /confirm again/);
    assert.equal(app.run("confirmImport()"), true);
    assert.deepEqual(app.history().map(item => item.id), [2, 3, 1]);
});
test("stale add cannot overwrite another tab", () => {
    const app = browser(); const concurrent = JSON.stringify([event(3), event()]); app.setRaw(concurrent);
    assert.equal(mutationPaths.add(app), false); assert.equal(app.raw(), concurrent);
    assert.deepEqual(app.history(), [event()]); assert.match(app.message(), /another tab/);
});
test("malformed selected file rejects all events before changing state", async () => {
    const app = browser(), before = app.raw();
    app.elements.get("import-file").files = [{ text: async () => JSON.stringify(envelope([event(2), event(3, { timestamp: "bad" })])) }];
    await app.run("handleImportFile()");
    assert.match(app.message(), /Event 2:/); assert.equal(app.raw(), before);
    assert.equal(app.control.writes, 0); assert.equal(app.run("pendingImport"), null);
});
test("invalid-hours fixture shows rejection at the import controls and disables confirmation", async () => {
    const app = browser(), before = app.raw(), history = app.history();
    prepareImport(app);
    assert.equal(app.elements.get("confirm-import-button").disabled, false);
    const contents = fs.readFileSync(path.join(__dirname, "fixtures/malformed-invalid-hours.json"), "utf8");
    app.elements.get("import-file").files = [{ text: async () => contents }];
    await app.elements.get("import-file").handlers.change();
    const summary = app.elements.get("import-summary");
    assert.equal(app.elements.get("import-preview").hidden, false, "rejection panel must be visible");
    assert.equal(summary.hidden, false, "rejection message must be visible inside the panel");
    assert.match(summary.textContent, /Import rejected: Event 1: hours/);
    assert.match(summary.textContent, /Existing history is unchanged/);
    assert.equal(summary.scrollOptions.block, "nearest", "error must be brought into view");
    assert.equal(app.elements.get("confirm-import-button").disabled, true);
    assert.equal(app.run("pendingImport"), null);
    assert.equal(app.run("confirmImport()"), false);
    assert.deepEqual(app.history(), history);
    assert.equal(app.raw(), before);
    assert.equal(app.control.writes, 0);
});
test("file read failure changes no records", async () => {
    const app = browser(); app.elements.get("import-file").files = [{ text: async () => { throw new Error("Read failed"); } }];
    await app.run("handleImportFile()"); assert.match(app.message(), /Read failed/);
    assert.deepEqual(app.history(), [event()]); assert.equal(app.control.writes, 0);
});
test("cancel during an asynchronous read invalidates its result", async () => {
    const app = browser(); let finish;
    app.elements.get("import-file").files = [{ text: () => new Promise(resolve => { finish = resolve; }) }];
    const reading = app.run("handleImportFile()");
    app.elements.get("cancel-import-button").handlers.click();
    finish(JSON.stringify(envelope([event(2)]))); await reading;
    assert.equal(app.run("pendingImport"), null); assert.equal(app.control.writes, 0);
});

async function selectFile(app, contents) {
    const input = app.elements.get("import-file");
    input.value = "C:\\fakepath\\acceptance.json";
    input.files = [{ text: async () => contents }];
    await input.handlers.change();
    return input;
}

test("safe integer boundary is accepted; unsafe and fractional IDs are rejected", () => {
    assert.equal(data.classifyCareerEvent(event(Number.MAX_SAFE_INTEGER), rules, 1).category, "evaluable");
    for (const id of [Number.MAX_SAFE_INTEGER + 1, -(Number.MAX_SAFE_INTEGER + 1), 1.5]) {
        const result = data.classifyCareerEvent(event(id), rules, 1);
        assert.equal(result.category, "malformed");
        assert.match(result.reason, /id must be a safe integer/);
        assert.throws(() => data.prepareEventMerge([event(id)], [], rules, 1), /safe integer/);
    }
});

test("rounded numeric ID collisions reject the complete file before duplicate merging", async () => {
    const app = browser(), before = app.raw();
    const contents = JSON.stringify(envelope([event("UNSAFE_A"), event("UNSAFE_B")]))
        .replace('"UNSAFE_A"', '9007199254740992').replace('"UNSAFE_B"', '9007199254740993');
    assert.equal(JSON.parse(contents).events[0].id, JSON.parse(contents).events[1].id);
    assert.throws(() => data.parseTrajectoryExport(contents, rules, 1), /Event 1: id must be a safe integer/);
    await selectFile(app, contents);
    assert.match(app.elements.get("import-summary").textContent, /safe integer/);
    assert.equal(app.run("pendingImport"), null);
    assert.deepEqual(app.history(), [event()]); assert.equal(app.raw(), before); assert.equal(app.control.writes, 0);
});

test("unsafe stored IDs enter recovery without rewriting or reassignment", async () => {
    const raw = JSON.stringify([event(Number.MAX_SAFE_INTEGER + 1)]);
    const app = browser([], { raw });
    assert.match(app.message(), /Changes are blocked/);
    assert.equal(app.elements.get("recovery-data-button").hidden, false);
    assert.equal(mutationPaths.add(app), false);
    app.run("resetCareerEvents()");
    await selectFile(app, JSON.stringify(envelope([event(2)])));
    assert.equal(app.elements.get("import-state").textContent, "Recovery required");
    assert.equal(app.raw(), raw); assert.equal(app.control.writes, 0);
    app.run("downloadRecoveryData()"); assert.equal(app.blobs.at(-1), raw);
});

for (const value of [NaN, Infinity, -Infinity]) {
    for (const [location, extension] of [
        ["direct", value], ["array", [0, value]], ["nested", { a: [{ b: { c: [null, value] } }] }]
    ]) {
        test(`rejects ${String(value)} in ${location} extension data, including unsupported records`, () => {
            for (const version of [1, 99]) {
                const result = data.classifyCareerEvent(event(2, { rulesetVersion: version, extension }), rules, 1);
                assert.equal(result.category, "malformed");
                assert.match(result.reason, /event\["extension"\].*finite number/);
            }
        });
    }
}

function overflowingEventText(value = "1e400") {
    return JSON.stringify(event(2, { rulesetVersion: 99, extension: { nested: ["OVERFLOW"] } }))
        .replace('"OVERFLOW"', value);
}

for (const value of ["1e400", "-1e400"]) {
    test(`import rejects ${value} without converting it to null or changing history`, async () => {
        const app = browser(), before = app.raw();
        const contents = JSON.stringify(envelope([])).replace('"events":[]', `"events":[${overflowingEventText(value)}]`);
        await selectFile(app, contents);
        assert.match(app.elements.get("import-summary").textContent, /Event 1:.*extension.*finite number/);
        assert.equal(app.elements.get("confirm-import-button").disabled, true);
        assert.equal(app.run("pendingImport"), null); assert.equal(app.raw(), before);
        assert.deepEqual(app.history(), [event()]); assert.equal(app.control.writes, 0);
    });
    test(`stored ${value} enters recovery and raw recovery retains the original number token`, async () => {
        const raw = `[${overflowingEventText(value)}]`, app = browser([], { raw });
        assert.match(app.message(), /Changes are blocked/);
        assert.equal(app.elements.get("recovery-data-button").hidden, false);
        for (const name of ["add", "delete", "reset"]) mutationPaths[name](app);
        await selectFile(app, JSON.stringify(envelope([event(3)])));
        assert.equal(app.elements.get("import-preview").hidden, false);
        assert.equal(app.elements.get("confirm-import-button").disabled, true);
        assert.equal(app.raw(), raw); assert.equal(app.control.writes, 0);
        app.run("downloadRecoveryData()"); assert.equal(app.blobs.at(-1), raw);
    });
}

test("persistence helper refuses non-finite extension values before serialization or storage access", () => {
    let accesses = 0;
    const storage = { getItem() { accesses++; return null; }, setItem() { accesses++; } };
    for (const value of [NaN, Infinity, -Infinity]) {
        assert.equal(data.persistCandidateEvents(storage, [event(2, { extension: [value] })], null).ok, false);
    }
    assert.equal(accesses, 0);
});

test("valid JSON extension data survives import, persistence, reload and export unchanged", async () => {
    const extension = JSON.parse('{"__proto__":{"safe":true},"nested":[null,false,"Infinity",0,1.25,{"values":[3,2,1]}]}');
    const historical = event(2, { rulesetVersion: 99, extension });
    const expected = JSON.stringify(historical), app = browser();
    await selectFile(app, JSON.stringify(envelope([historical])));
    assert.equal(app.run("confirmImport()"), true);
    assert.equal(JSON.stringify(app.history()[0]), expected);
    const reload = browser([], { raw: app.raw() }); reload.run("exportCareerEvents()");
    assert.equal(JSON.stringify(JSON.parse(reload.blobs.at(-1)).events[0]), expected);
    assert.equal(JSON.stringify(historical), expected);
});

test("import save failure is visible locally and the same candidate can be retried", () => {
    const app = browser(), before = app.raw(); prepareImport(app);
    app.control.failWrite = true;
    assert.equal(app.run("confirmImport()"), false);
    assert.equal(app.elements.get("import-preview").hidden, false);
    assert.equal(app.elements.get("import-state").textContent, "Save failed");
    assert.equal(app.elements.get("import-preview-title").textContent, "Import not saved");
    assert.match(app.elements.get("import-summary").textContent, /Could not save.*Nothing was changed/);
    assert.equal(app.elements.get("confirm-import-button").disabled, false);
    assert.equal(app.raw(), before); assert.deepEqual(app.history(), [event()]);
    app.control.failWrite = false;
    assert.equal(app.run("confirmImport()"), true);
    assert.match(app.message(), /Trajectory data imported/); assert.equal(app.control.writes, 1);
});

test("temporary import storage-read failure is visible and safe to retry", () => {
    const app = browser(), before = app.raw(); prepareImport(app);
    app.control.failRead = true;
    assert.equal(app.run("confirmImport()"), false);
    assert.equal(app.elements.get("import-preview").hidden, false);
    assert.equal(app.elements.get("import-state").textContent, "Storage read failed");
    assert.match(app.elements.get("import-summary").textContent, /Nothing was imported.*retry/);
    assert.equal(app.elements.get("confirm-import-button").disabled, false);
    assert.equal(app.raw(), before); assert.deepEqual(app.history(), [event()]);
    app.control.failRead = false;
    assert.equal(app.run("confirmImport()"), true); assert.equal(app.control.writes, 1);
});

test("newly corrupted storage during confirmation blocks writes and exposes raw recovery", () => {
    const app = browser(); prepareImport(app);
    const raw = `[${overflowingEventText()}]`; app.setRaw(raw);
    assert.equal(app.run("confirmImport()"), false);
    assert.equal(app.elements.get("import-preview").hidden, false);
    assert.equal(app.elements.get("import-state").textContent, "Recovery required");
    assert.equal(app.elements.get("confirm-import-button").disabled, true);
    assert.equal(app.elements.get("recovery-data-button").hidden, false);
    assert.equal(app.run("pendingImport"), null);
    assert.equal(mutationPaths.add(app), false); app.run("resetCareerEvents()");
    assert.equal(app.raw(), raw); assert.equal(app.control.writes, 0);
    app.run("downloadRecoveryData()"); assert.equal(app.blobs.at(-1), raw);
});

test("late storage change during import save shows a local error and requires a fresh preview", () => {
    const app = browser(); prepareImport(app);
    const concurrent = JSON.stringify([event(3), event()]);
    app.storage.getItem = (() => { let reads = 0; return () => ++reads === 1 ? app.raw() : concurrent; })();
    assert.equal(app.run("confirmImport()"), false);
    assert.equal(app.elements.get("import-state").textContent, "History changed");
    assert.equal(app.elements.get("confirm-import-button").disabled, true);
    assert.equal(app.run("pendingImport"), null); assert.equal(app.control.writes, 0);
    assert.deepEqual(app.history(), [event()]);
});

test("same file selection is reset immediately and works again after successful import and reset", async () => {
    const app = browser(), contents = JSON.stringify(envelope([event(2)]));
    const input = await selectFile(app, contents);
    assert.equal(input.value, "");
    assert.equal(app.run("confirmImport()"), true); app.run("resetCareerEvents()");
    await selectFile(app, contents);
    assert.equal(input.value, "");
    assert.equal(app.elements.get("confirm-import-button").disabled, false);
    assert.equal(app.run("confirmImport()"), true);
    assert.deepEqual(app.history(), [event(2)]);
});

test("same file can be selected repeatedly after rejection without enabling confirmation", async () => {
    const app = browser(), before = app.raw();
    const contents = JSON.stringify(envelope([event(2, { measurements: { hours: -1 } })]));
    for (let attempt = 0; attempt < 2; attempt++) {
        const input = await selectFile(app, contents);
        assert.equal(input.value, "");
        assert.match(app.elements.get("import-summary").textContent, /hours/);
        assert.equal(app.elements.get("confirm-import-button").disabled, true);
    }
    assert.equal(app.raw(), before); assert.equal(app.control.writes, 0);
});

(async function() {
    let passed = 0, failed = 0;
    for (const { name, run } of tests) {
        try { await run(); passed++; console.log(`PASS ${name}`); }
        catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`); }
    }
    console.log(`\n${passed} passing, ${failed} failing`);
    process.exitCode = failed ? 1 : 0;
})();
