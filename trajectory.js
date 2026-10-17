let totalXP = 0;

const activityCountDisplay = document.getElementById("activity-count");
const totalHoursDisplay = document.getElementById("total-hours");
const trajectorySignal = document.getElementById("trajectory-signal");

const exportDataButton = document.getElementById("export-data-button");
const resetDataButton = document.getElementById("reset-data-button");
const formGrid = document.getElementById("form-grid");

const activityTypeInput =
    document.getElementById("activity-type");

const customTypeField =
    document.getElementById("custom-type-field");

const customActivityTypeInput =
    document.getElementById("custom-activity-type");

activityTypeInput.addEventListener("change", function() {
    const isOther = activityTypeInput.value === "other";

    customTypeField.hidden = !isOther;
    customActivityTypeInput.required = isOther;

    formGrid.classList.toggle("has-custom-type", isOther);

    if (!isOther) {
        customActivityTypeInput.value = "";
    }
});

const CURRENT_RULESET_VERSION = 1;

const data = TrajectoryData;

const dimensionXP = {
    learning: 0,
    building: 0,
    "problem-solving": 0,
    career: 0,
    creativity: 0
};

let storageLoadError = "";
let storageSnapshot = null;
let recoveryRaw = null;
let pendingImport = null;
let importSelection = 0;
let careerEvents = [];

function exportCareerEvents() {
    if (storageLoadError) {
        downloadRecoveryData();
        return;
    }
    const exportData = data.buildTrajectoryExport(careerEvents, activityRules, CURRENT_RULESET_VERSION);

    const fileContents =
        JSON.stringify(exportData, null, 2);

    const file = new Blob(
        [fileContents],
        { type: "application/json" }
    );

    const downloadUrl =
        URL.createObjectURL(file);

    const downloadLink =
        document.createElement("a");

    const date =
        new Date().toISOString().slice(0, 10);

    downloadLink.href = downloadUrl;
    downloadLink.download =
        `trajectory-export-${date}.json`;

    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();

    URL.revokeObjectURL(downloadUrl);

    formMessage.textContent =
        "Trajectory data exported.";
}

function resetCareerEvents() {
    const confirmed = window.confirm(
        "Reset all Trajectory data? This cannot be undone."
    );

    if (!confirmed) {
        return;
    }

    return saveCareerEvents([], "Trajectory data reset.");
}

function loadCareerEvents() {
    let result;
    try {
        result = data.readStoredEvents(window.localStorage, activityRules, CURRENT_RULESET_VERSION);
    } catch (error) {
        result = { ok: false, raw: null, error };
    }
    recoveryRaw = result.raw;
    if (!result.ok) {
        storageLoadError = "Saved history could not be read safely. Changes are blocked. Download recovery data if available, then repair storage and reload.";
        formMessage.textContent = storageLoadError;
        document.getElementById("recovery-data-button").hidden = result.raw === null;
        return [];
    }
    storageSnapshot = result.raw;
    return result.events;
}

const activityList = document.getElementById("activity-list");

const activityForm = document.getElementById("activity-form");

const formMessage = document.getElementById("form-message");

const activityRules = {
    learning: {
        xpPerHour: 20,
        dimensions: {
            learning: 1
        }
    },

    leetcode: {
        xpPerHour: 25,
        dimensions: {
            "problem-solving": 0.7,
            learning: 0.3
        }
    },

    "project-work": {
        xpPerHour: 30,
        dimensions: {
            building: 0.6,
            "problem-solving": 0.2,
            creativity: 0.2,
        }
    },

    "hackathon": {
        xpPerHour: 40,
        dimensions: {
            building: 0.4,
            "problem-solving": 0.4,
            creativity: 0.2
        }
    },

    "research": {
        xpPerHour: 35,
        dimensions: {
            learning: 0.6,
            "problem-solving": 0.3,
            creativity: 0.1
        }
    },

    other: {
        xpPerHour: 0,
        dimensions: {}
    }
};


function calculateXP(activityType, amount) {
    const rule = activityRules[activityType];

    return rule.xpPerHour * amount;
}

function formatXP(xp) {
    return Number(xp.toFixed(3));
}

function calculateDimensionAllocations(activityType, xpEarned) {
    const dimensions = activityRules[activityType].dimensions;
    const dimensionAllocations = {};

    for (const dimension in dimensions) {
        const allocation = dimensions[dimension];

        dimensionAllocations[dimension] =
            xpEarned * allocation;
    }

    return dimensionAllocations;
}

function evaluateCareerEvent(careerEvent) {
    const xpEarned = calculateXP(
        careerEvent.activityType,
        careerEvent.measurements.hours
    );

    const dimensions = calculateDimensionAllocations(
        careerEvent.activityType,
        xpEarned
    );

    return {
        xpEarned,
        dimensions
    };
}

function applyEvaluationToState(evaluation) {
    totalXP += evaluation.xpEarned;

    for (const dimension in evaluation.dimensions) {
        dimensionXP[dimension] +=
            evaluation.dimensions[dimension];
    }
}

function createCareerEvent(
    activityType,
    amount,
    activityDescription,
    activityLabel = null
) {
    return {
        id: Date.now(),
        activityType,
        activityLabel,
        measurements: {
            hours: amount
        },
        description: activityDescription,
        source: "manual",
        timestamp: new Date().toISOString(),
        rulesetVersion: CURRENT_RULESET_VERSION,
    };
}

function getActivityLabel(careerEvent) {
    if (
        careerEvent.activityType === "other" &&
        careerEvent.activityLabel
    ) {
        return careerEvent.activityLabel;
    }

    return formatDimensionName(careerEvent.activityType);
}

function renderRecentActivity(careerEvent) {
    const activityItem = document.createElement("li");
    const activityText = document.createElement("span");
    const deleteButton = document.createElement("button");

    activityText.textContent =
    `${careerEvent.description} — ${getActivityLabel(careerEvent)} — ${careerEvent.measurements.hours}h`;
    const classification = data.classifyCareerEvent(careerEvent, activityRules, CURRENT_RULESET_VERSION);
    if (classification.category === "unsupported") {
        activityText.textContent += ` — Evaluation unavailable: ${classification.reason}`;
    }

    deleteButton.type = "button";
    deleteButton.textContent = "Delete";

    deleteButton.addEventListener("click", function() {
        deleteCareerEvent(careerEvent.id);
    });

    activityItem.append(
        activityText,
        deleteButton
    );

    activityList.prepend(activityItem);
}

function formatDimensionName(dimension) {
    return dimension
        .split("-")
        .map(word =>
            word.charAt(0).toUpperCase() + word.slice(1)
        )
        .join(" ");
}

function updateDashboard() {
    const activityCount = careerEvents.length;

    const totalHours = careerEvents.reduce(
        (sum, careerEvent) =>
            sum + careerEvent.measurements.hours,
        0
    );

    activityCountDisplay.textContent = activityCount;
    totalHoursDisplay.textContent = Number(totalHours.toFixed(2));

    if (activityCount === 0) {
        trajectorySignal.textContent =
            "Start logging activity to build your trajectory.";
        return;
    }

    const hoursByActivityType = Object.create(null);

    for (const careerEvent of careerEvents) {
        const activityType = getActivityLabel(careerEvent);
        const hours = careerEvent.measurements.hours;

        hoursByActivityType[activityType] =
            (hoursByActivityType[activityType] || 0) + hours;
    }

    const mostActiveActivity = Object.entries(hoursByActivityType)
        .reduce((highest, current) =>
            current[1] > highest[1] ? current : highest
        );

    trajectorySignal.textContent =
        `Most time spent: ${formatDimensionName(mostActiveActivity[0])} (${mostActiveActivity[1]}h).`;
}

function resetDerivedState() {
    totalXP = 0;

    for (const dimension in dimensionXP) {
        dimensionXP[dimension] = 0;
    }

    activityList.innerHTML = "";
}

function restoreCareerEvents() {
    resetDerivedState();

    for (const careerEvent of careerEvents) {
        if (!data.isEvaluableCareerEvent(careerEvent, activityRules, CURRENT_RULESET_VERSION)) continue;
        const evaluation = evaluateCareerEvent(careerEvent);

        applyEvaluationToState(evaluation);
    }

    updateDashboard();

    const recentEvents = [...careerEvents].reverse();

    for (const careerEvent of recentEvents) {
        renderRecentActivity(careerEvent);
    }
}

function saveCareerEvents(candidate, successMessage, isImport = false) {
    if (storageLoadError) {
        formMessage.textContent = storageLoadError;
        if (isImport) showImportError(storageLoadError, { title: "Import not saved", status: "Recovery required" });
        return false;
    }
    let result;
    try {
        result = data.persistCandidateEvents(window.localStorage, candidate, storageSnapshot);
    } catch (error) {
        result = { ok: false, error };
    }
    if (!result.ok) {
        formMessage.textContent = result.changed
            ? "Saved history changed in another tab. Nothing was saved. Reload before making changes."
            : "Could not save history. Nothing was changed. Storage may be full or blocked; you can retry.";
        if (isImport) showImportError(formMessage.textContent, {
            title: "Import not saved", status: result.changed ? "History changed" : "Save failed", retry: !result.changed
        });
        return false;
    }
    // Persistence is complete. Rendering failures must never be described as a rollback.
    storageSnapshot = result.raw;
    careerEvents = candidate;
    pendingImport = null;
    try {
        document.getElementById("import-preview").hidden = true;
        restoreCareerEvents();
        formMessage.textContent = successMessage;
    } catch (error) {
        formMessage.textContent = "History was saved, but the display could not update. Reload to recover the saved history, or export it now.";
    }
    return true;
}

function deleteCareerEvent(eventId) {
    const confirmed =
        window.confirm("Delete this activity?");

    if (!confirmed) {
        return;
    }

    const eventIndex = careerEvents.findIndex(
        careerEvent => careerEvent.id === eventId
    );

    if (eventIndex === -1) {
        formMessage.textContent =
            "That activity could not be found.";
        return;
    }

    return saveCareerEvents(careerEvents.filter((_, index) => index !== eventIndex), "Activity deleted.");
}

function isValidCareerEvent(event) {
    return data.classifyCareerEvent(event, activityRules, CURRENT_RULESET_VERSION).category !== "malformed";
}

careerEvents = loadCareerEvents();
try {
    restoreCareerEvents();
} catch (error) {
    formMessage.textContent = "Saved history remains in storage, but the display failed. Reload or export your data.";
}

function addCareerEvent(event) {
    if (!isValidCareerEvent(event)) {
        formMessage.textContent = "Invalid Career Event.";
        return false;
    }
    if (careerEvents.some(existing => existing.id === event.id)) {
        formMessage.textContent = "An activity with this ID already exists. Please try again.";
        return false;
    }
    return saveCareerEvents([event, ...careerEvents], "Activity added.");
}

async function handleImportFile() {
    const selection = ++importSelection;
    pendingImport = null;
    document.getElementById("import-preview").hidden = true;
    const input = document.getElementById("import-file");
    const file = input.files[0];
    // Keep the File reference, but allow the same path to trigger change next time.
    input.value = "";
    if (storageLoadError) {
        showImportError(storageLoadError, { title: "Import unavailable", status: "Recovery required" });
        return;
    }
    if (!file) return;
    try {
        const contents = await file.text();
        if (selection !== importSelection) return;
        const imported = data.parseTrajectoryExport(contents, activityRules, CURRENT_RULESET_VERSION);
        renderImportPreview(imported);
    } catch (error) {
        if (selection !== importSelection) return;
        const message = `Import rejected: ${error.message} Existing history is unchanged.`;
        showImportError(message);
    }
}

function showImportError(message, { title = "Import rejected", status = "Validation error", retry = false } = {}) {
    if (!retry) pendingImport = null;
    formMessage.textContent = message;
    const summary = document.getElementById("import-summary");
    summary.textContent = message;
    document.getElementById("import-preview").className = "import-preview--error";
    document.getElementById("import-preview-title").textContent = title;
    document.getElementById("import-state").textContent = status;
    document.getElementById("import-details").hidden = !retry;
    document.getElementById("confirm-import-button").disabled = !retry;
    document.getElementById("import-preview").hidden = false;
    summary.scrollIntoView({ block: "nearest" });
}

function renderImportPreview(imported) {
    const merge = data.prepareEventMerge(careerEvents, imported.events, activityRules, CURRENT_RULESET_VERSION);
    pendingImport = { imported, merge, snapshot: storageSnapshot };
    const conflictText = merge.conflicts.length ? ` Conflicting IDs: ${merge.conflicts.join(", ")}. Import blocked.` : "";
    const blocked = merge.conflicts.length > 0;
    document.getElementById("import-preview").className = blocked ? "import-preview--blocked" : "import-preview--ready";
    document.getElementById("import-preview-title").textContent = blocked ? "Resolve conflicts before importing" : "Review Import";
    document.getElementById("import-state").textContent = blocked ? "Import blocked" : merge.added ? "Ready to merge" : "Already up to date";
    document.getElementById("import-details").hidden = false;
    document.getElementById("import-new-count").textContent = merge.added;
    document.getElementById("import-duplicate-count").textContent = merge.duplicates;
    document.getElementById("import-unsupported-count").textContent = merge.unsupported;
    document.getElementById("import-metadata").textContent =
        `Exported ${imported.exportedAt} · Export version ${imported.exportVersion} · Ruleset ${imported.rulesetVersion}`;
    document.getElementById("import-summary").textContent =
        blocked ? `No events will be imported until conflicting IDs are resolved.${conflictText}` :
        merge.added ? "Review the counts below, then confirm to merge into your history." :
        "All events are already present. No changes are needed.";
    document.getElementById("confirm-import-button").disabled = merge.conflicts.length > 0 || merge.added === 0;
    document.getElementById("import-preview").hidden = false;
    formMessage.textContent = merge.added === 0 && !merge.conflicts.length
        ? "All events are already present. Nothing was written." : "Review the import before confirming.";
}

function confirmImport() {
    if (!pendingImport || pendingImport.merge.conflicts.length || !pendingImport.merge.added) return false;
    let current;
    try {
        current = data.readStoredEvents(window.localStorage, activityRules, CURRENT_RULESET_VERSION);
    } catch (error) {
        current = { ok: false };
    }
    if (!current.ok) {
        const corrupt = current.raw !== null && current.raw !== undefined;
        const message = corrupt
            ? "Stored history is invalid. Nothing was imported. Download recovery data, repair storage and reload."
            : "Stored history could not be read. Nothing was imported. Restore storage access and retry, or reload.";
        if (corrupt) {
            recoveryRaw = current.raw;
            storageLoadError = message;
            document.getElementById("recovery-data-button").hidden = false;
        }
        showImportError(message, { title: "Import not saved", status: corrupt ? "Recovery required" : "Storage read failed", retry: !corrupt });
        return false;
    }
    if (current.raw !== pendingImport.snapshot) {
        const imported = pendingImport.imported;
        careerEvents = current.events;
        storageSnapshot = current.raw;
        try {
            restoreCareerEvents();
            renderImportPreview(imported);
            formMessage.textContent = "Stored history changed. Review the rebuilt preview and confirm again.";
        } catch (error) {
            showImportError("History changed and the display could not update. Nothing was imported. Reload.",
                { title: "Import not saved", status: "Display error" });
        }
        return false;
    }
    return saveCareerEvents(pendingImport.merge.events, "Trajectory data imported.", true);
}

function downloadRecoveryData() {
    if (recoveryRaw === null) {
        formMessage.textContent = "Raw storage could not be read. Restore storage access and reload to retry recovery.";
        return;
    }
    const file = new Blob([recoveryRaw], { type: "application/octet-stream" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "trajectory-recovery.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    formMessage.textContent = "Raw saved history downloaded unchanged. Keep this file before repairing storage.";
}

activityForm.addEventListener("submit", function(event) {
    event.preventDefault();

    const activityType = document.getElementById("activity-type").value;
    
    const customActivityType =
    customActivityTypeInput.value.trim();

    const activityAmount = document.getElementById("activity-amount").value;

    const activityDescription = document.getElementById("activity-description").value.trim();

    const amount = Number(activityAmount);

    formMessage.textContent = "";

    if (!Object.hasOwn(activityRules, activityType)) {
        formMessage.textContent =
            "Please select a valid activity type.";
        return;
    }

    if (
        activityType === "other" &&
        customActivityType.length === 0
    ) {
        formMessage.textContent =
            "Please enter a custom activity type.";
        return;
    }

    if (
        !Number.isFinite(amount) ||
        amount < 0.25 ||
        amount > 24
    ) {
        formMessage.textContent =
            "Hours must be between 0.25 and 24.";
        return;
    }

    if (activityDescription.length === 0) {
        formMessage.textContent =
            "Please describe what you worked on.";
        return;
    }

   const careerEvent = createCareerEvent(
        activityType,
        amount,
        activityDescription,
        activityType === "other"
            ? customActivityType
            : null
    );

    if (!addCareerEvent(careerEvent)) return;
    activityForm.reset();

    customTypeField.hidden = true;
    customActivityTypeInput.required = false;
    formGrid.classList.remove("has-custom-type");

    console.log("Type:", activityType);
    console.log("Amount:", activityAmount);
    console.log("Description:", activityDescription);
});

exportDataButton.addEventListener(
    "click",
    exportCareerEvents
);

resetDataButton.addEventListener(
    "click",
    resetCareerEvents
);


document.getElementById("import-file").addEventListener("change", handleImportFile);
document.getElementById("confirm-import-button").addEventListener("click", confirmImport);
document.getElementById("cancel-import-button").addEventListener("click", function() {
    importSelection++;
    pendingImport = null;
    document.getElementById("import-preview").hidden = true;
    document.getElementById("import-file").value = "";
    formMessage.textContent = "Import canceled. Nothing was changed.";
});
document.getElementById("recovery-data-button").addEventListener("click", downloadRecoveryData);
