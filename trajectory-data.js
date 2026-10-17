/* Shared by the browser and dependency-free Node tests. No storage or DOM globals. */
(function(root) {
    "use strict";

    const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
    const nonempty = value => typeof value === "string" && value.trim().length > 0;
    const positiveInteger = value => Number.isInteger(value) && value > 0;

    function findNonFiniteNumber(value) {
        const pending = [{ value, path: "event" }];
        const visited = new WeakSet();
        while (pending.length) {
            const current = pending.pop();
            if (typeof current.value === "number" && !Number.isFinite(current.value)) {
                return `${current.path} must contain a finite number`;
            }
            if (current.value !== null && typeof current.value === "object" && !visited.has(current.value)) {
                visited.add(current.value);
                for (const key of Object.keys(current.value)) {
                    pending.push({ value: current.value[key], path: `${current.path}[${JSON.stringify(key)}]` });
                }
            }
        }
        return "";
    }

    function classifyCareerEvent(event, rules, version) {
        let error = "";
        if (!isRecord(event)) error = "record must be an object";
        else if (!Number.isSafeInteger(event.id)) error = "id must be a safe integer";
        else if (!nonempty(event.activityType)) error = "activityType must be a nonempty string";
        else if (!isRecord(event.measurements) || !Number.isFinite(event.measurements.hours) ||
            event.measurements.hours < 0.25 || event.measurements.hours > 24) error = "hours must be a number between 0.25 and 24";
        else if (!nonempty(event.description)) error = "description must be a nonempty string";
        else if (!nonempty(event.source)) error = "source must be a nonempty string";
        else if (typeof event.timestamp !== "string" || Number.isNaN(Date.parse(event.timestamp))) error = "timestamp must be a valid date string";
        else if (Object.hasOwn(event, "rulesetVersion") && !positiveInteger(event.rulesetVersion)) error = "rulesetVersion must be a positive integer when present";
        else if (event.activityType === "other" && !nonempty(event.activityLabel)) error = "other activities require a nonempty activityLabel";
        if (!error) error = findNonFiniteNumber(event);
        if (error) return { category: "malformed", reason: error };
        if (event.rulesetVersion !== version) return { category: "unsupported", reason: "ruleset unavailable or unspecified" };
        if (!Object.hasOwn(rules, event.activityType)) return { category: "unsupported", reason: "activity type unavailable" };
        return { category: "evaluable", reason: "" };
    }

    function isEvaluableCareerEvent(event, rules, version) {
        return classifyCareerEvent(event, rules, version).category === "evaluable";
    }

    function validateEvents(events, rules, version) {
        if (!Array.isArray(events)) throw new Error("events must be an array");
        events.forEach((event, index) => {
            const result = classifyCareerEvent(event, rules, version);
            if (result.category === "malformed") throw new Error(`Event ${index + 1}: ${result.reason}.`);
        });
    }

    function parseTrajectoryExport(contents, rules, version) {
        const data = JSON.parse(contents);
        if (!isRecord(data) || data.exportVersion !== 1) throw new Error("Unsupported or missing exportVersion; expected 1.");
        if (!positiveInteger(data.rulesetVersion)) throw new Error("Invalid export rulesetVersion.");
        if (typeof data.exportedAt !== "string" || Number.isNaN(Date.parse(data.exportedAt))) throw new Error("Invalid exportedAt date.");
        if (!isRecord(data.activityRules)) throw new Error("activityRules must be an object.");
        validateEvents(data.events, rules, version);
        return data;
    }

    // JSON types and array order matter; object property insertion order does not.
    function recordsEqual(left, right) {
        if (left === right) return true;
        if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
        if (Array.isArray(left) !== Array.isArray(right)) return false;
        if (Array.isArray(left)) return left.length === right.length && left.every((value, index) => recordsEqual(value, right[index]));
        const keys = Object.keys(left);
        return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && recordsEqual(left[key], right[key]));
    }

    function prepareEventMerge(existing, incoming, rules, version) {
        validateEvents(existing, rules, version);
        validateEvents(incoming, rules, version);
        const byId = new Map();
        for (const event of existing) {
            if (byId.has(event.id)) throw new Error(`Existing history contains duplicate ID ${event.id}; recover it before importing.`);
            byId.set(event.id, event);
        }
        const added = [];
        let duplicates = 0;
        const conflicts = new Set();
        for (const event of incoming) {
            if (byId.has(event.id)) {
                if (recordsEqual(byId.get(event.id), event)) duplicates++;
                else conflicts.add(event.id);
            } else {
                byId.set(event.id, event);
                added.push(event);
            }
        }
        return {
            events: [...added, ...existing],
            added: added.length,
            duplicates,
            conflicts: [...conflicts],
            unsupported: incoming.filter(event => !isEvaluableCareerEvent(event, rules, version)).length
        };
    }

    function buildTrajectoryExport(events, rules, version, exportedAt = new Date().toISOString()) {
        return { exportVersion: 1, rulesetVersion: version, exportedAt, activityRules: rules, events };
    }

    function readStoredEvents(storage, rules, version) {
        let raw = null;
        try {
            raw = storage.getItem("trajectoryEvents");
            const events = raw === null ? [] : JSON.parse(raw);
            validateEvents(events, rules, version);
            const ids = new Set();
            for (const event of events) {
                if (ids.has(event.id)) throw new Error(`Duplicate stored ID ${event.id}.`);
                ids.add(event.id);
            }
            return { ok: true, events, raw };
        } catch (error) {
            return { ok: false, events: [], raw, error };
        }
    }

    function persistCandidateEvents(storage, candidate, expectedRaw) {
        try {
            const numberError = findNonFiniteNumber(candidate);
            if (numberError) throw new Error(numberError);
            const raw = JSON.stringify(candidate);
            if (storage.getItem("trajectoryEvents") !== expectedRaw) return { ok: false, changed: true };
            storage.setItem("trajectoryEvents", raw);
            return { ok: true, raw };
        } catch (error) {
            return { ok: false, error };
        }
    }

    const api = { classifyCareerEvent, isEvaluableCareerEvent, parseTrajectoryExport, recordsEqual,
        prepareEventMerge, buildTrajectoryExport, readStoredEvents, persistCandidateEvents };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.TrajectoryData = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
