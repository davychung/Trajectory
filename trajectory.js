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

const VALID_EVENT_SOURCES = new Set([
    "manual",
    "import"
]);

const dimensionXP = {
    learning: 0,
    building: 0,
    "problem-solving": 0,
    career: 0,
    creativity: 0
};

let storageLoadError = "";

function exportCareerEvents() {
    const exportData = {
        exportVersion: 1,
        rulesetVersion: CURRENT_RULESET_VERSION,
        exportedAt: new Date().toISOString(),
        activityRules,
        events: careerEvents
    };

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

    careerEvents.length = 0;

    saveCareerEvents();
    restoreCareerEvents();

    formMessage.textContent =
        "Trajectory data reset.";
}

function loadCareerEvents() {
    const storedCareerEvents =
        localStorage.getItem("trajectoryEvents");

    if (!storedCareerEvents) {
        return [];
    }

    try {
        const parsedEvents = JSON.parse(storedCareerEvents);

        if (!Array.isArray(parsedEvents)) {
            throw new Error(
                "Stored Career Events must be an array."
            );
        }

        return parsedEvents;
    } catch (error) {
        console.error(
            "Could not load Trajectory events:",
            error
        );

        localStorage.setItem(
            "trajectoryEventsBackup",
            storedCareerEvents
        );

        storageLoadError =
            "Saved activity data could not be loaded. A backup was preserved.";

        return [];
    }
}

const careerEvents = loadCareerEvents();

const activityList = document.getElementById("activity-list");

const activityForm = document.getElementById("activity-form");

const formMessage = document.getElementById("form-message");

if (storageLoadError) {
    formMessage.textContent = storageLoadError;
}

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

function migrateCareerEvents() {
    let migrationOccurred = false;

    for (const careerEvent of careerEvents) {
        if (
            careerEvent !== null &&
            typeof careerEvent === "object" &&
            !Object.hasOwn(careerEvent, "rulesetVersion")
        ) {
            careerEvent.rulesetVersion =
                CURRENT_RULESET_VERSION;

            migrationOccurred = true;
        }
    }

    if (migrationOccurred) {
        saveCareerEvents();
    }
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

    const hoursByActivityType = {};

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
        const evaluation = evaluateCareerEvent(careerEvent);

        applyEvaluationToState(evaluation);
    }

    updateDashboard();

    const recentEvents = [...careerEvents].reverse();

    for (const careerEvent of recentEvents) {
        renderRecentActivity(careerEvent);
    }
}

function saveCareerEvents() {
    localStorage.setItem(
        "trajectoryEvents",
        JSON.stringify(careerEvents)
    );
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

    careerEvents.splice(eventIndex, 1);

    saveCareerEvents();
    restoreCareerEvents();

    formMessage.textContent = "Activity deleted.";
}

function isValidCareerEvent(careerEvent) {
    return (
        careerEvent !== null &&
        typeof careerEvent === "object" &&
        careerEvent.rulesetVersion === CURRENT_RULESET_VERSION &&
        Number.isFinite(careerEvent.id) &&
        Object.hasOwn(
            activityRules,
            careerEvent.activityType
        ) &&
        careerEvent.measurements !== null &&
        typeof careerEvent.measurements === "object" &&
        Number.isFinite(
            careerEvent.measurements.hours
        ) &&
        careerEvent.measurements.hours >= 0.25 &&
        careerEvent.measurements.hours <= 24 &&
        typeof careerEvent.description === "string" &&
        careerEvent.description.trim().length > 0 &&

        (
            careerEvent.activityType !== "other" ||
            (
                typeof careerEvent.activityLabel === "string" &&
                careerEvent.activityLabel.trim().length > 0
            )
        ) &&

        VALID_EVENT_SOURCES.has(careerEvent.source) &&
        typeof careerEvent.timestamp === "string" &&
        !Number.isNaN(
            Date.parse(careerEvent.timestamp)
        )
    );
}

function removeInvalidCareerEvents() {
    const validEvents =
        careerEvents.filter(isValidCareerEvent);

    if (validEvents.length === careerEvents.length) {
        return;
    }

    localStorage.setItem(
        "trajectoryEventsBackup",
        JSON.stringify(careerEvents)
    );

    careerEvents.length = 0;
    careerEvents.push(...validEvents);

    saveCareerEvents();

    formMessage.textContent =
        "Some invalid saved activities were skipped. A backup was preserved.";
}


migrateCareerEvents();
removeInvalidCareerEvents();
restoreCareerEvents();

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

    const evaluation = evaluateCareerEvent(careerEvent);

    applyEvaluationToState(evaluation);
    
    careerEvents.unshift(careerEvent);

    saveCareerEvents();

    console.log("Career Event:", careerEvent);
    console.log("All Career Events:", careerEvents);

    console.log(dimensionXP);

    updateDashboard();

    renderRecentActivity(careerEvent);

    formMessage.textContent = "Activity added.";
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