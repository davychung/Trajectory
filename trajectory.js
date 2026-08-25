let totalXP = 0;

const dimensionDisplays = {
    "problem-solving": {
        xp: document.getElementById("problem-solving-xp"),
        fill: document.getElementById("problem-solving-fill")
    },

    building: {
        xp: document.getElementById("building-xp"),
        fill: document.getElementById("building-fill")
    },

    learning: {
        xp: document.getElementById("learning-xp"),
        fill: document.getElementById("learning-fill")
    },

    career: {
        xp: document.getElementById("career-xp"),
        fill: document.getElementById("career-fill")
    },

    creativity: {
        xp: document.getElementById("creativity-xp"),
        fill: document.getElementById("creativity-fill")
    }
};

const nextLevelText = document.getElementById("next-level-text");
const levelProgressFill = document.getElementById("level-progress-fill");

const exportDataButton = document.getElementById("export-data-button");
const resetDataButton = document.getElementById("reset-data-button");

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

const totalXPDisplay = document.getElementById("total-xp");

const activityForm = document.getElementById("activity-form");

const levelDisplay = document.getElementById("level");

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
    }
};


function calculateXP(activityType, amount) {
    const rule = activityRules[activityType];

    return rule.xpPerHour * amount;
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

function calculateLevel(totalXP) {
    return Math.floor(Math.sqrt(totalXP / 100)) + 1;
}

function calculateRank(level) {
    if (level <= 5) {
        return "Student";
    } else if (level <= 10) {
        return "Intern";
    } else if (level <= 20) {
        return "Junior";
    } else if (level <= 35) {
        return "Mid";
    } else {
        return "Senior";
    }
}

function updateDimensionBars() {
    for (const dimension in dimensionXP) {
        const percentage =
            totalXP === 0
                ? 0
                : (dimensionXP[dimension] / totalXP) * 100;

        dimensionDisplays[dimension].fill.style.width =
            `${percentage}%`;

        dimensionDisplays[dimension].xp.textContent =
            `${dimensionXP[dimension]} XP (${percentage.toFixed(1)}%)`;
    }
}

function updateLevelProgress(totalXP, currentLevel) {
    const currentLevelXP = Math.pow(currentLevel - 1, 2) * 100;
    const nextLevelXP = Math.pow(currentLevel, 2) * 100;

    const xpIntoLevel = totalXP - currentLevelXP;
    const xpNeededForLevel = nextLevelXP - currentLevelXP;
    const xpRemaining = nextLevelXP - totalXP;

    const percentage =
        (xpIntoLevel / xpNeededForLevel) * 100;

    nextLevelText.textContent =
        `${xpRemaining} XP to Level ${currentLevel + 1}`;

    levelProgressFill.style.width =
        `${percentage}%`;
}

function createCareerEvent(
    activityType,
    amount,
    activityDescription
) {
    return {
        id: Date.now(),
        activityType,
        measurements: {
            hours: amount
        },
        description: activityDescription,
        source: "manual",
        timestamp: new Date().toISOString()
    };
}

function renderRecentActivity(careerEvent, xpEarned) {
    const activityItem = document.createElement("li");
    const activityText = document.createElement("span");
    const deleteButton = document.createElement("button");

    activityText.textContent =
        `${careerEvent.description} — ${careerEvent.activityType} — +${xpEarned} XP`;

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

function updateDashboard() {
    totalXPDisplay.textContent = totalXP;

    const currentLevel = calculateLevel(totalXP);
    const currentRank = calculateRank(currentLevel);

    levelDisplay.textContent =
        `${currentLevel} (${currentRank})`;

    updateLevelProgress(totalXP, currentLevel);
    updateDimensionBars();
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
        const evaluation = evaluateCareerEvent(careerEvent);

        renderRecentActivity(
            careerEvent,
            evaluation.xpEarned
        );
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
        careerEvent.source === "manual" &&
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

removeInvalidCareerEvents();
restoreCareerEvents();

activityForm.addEventListener("submit", function(event) {
    event.preventDefault();

    const activityType = document.getElementById("activity-type").value;

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
    activityDescription
    );

    const evaluation = evaluateCareerEvent(careerEvent);

    applyEvaluationToState(evaluation);
    
    careerEvents.unshift(careerEvent);

    saveCareerEvents();

    console.log("Career Event:", careerEvent);
    console.log("All Career Events:", careerEvents);

    console.log(dimensionXP);

    updateDashboard();

    renderRecentActivity(
    careerEvent,
    evaluation.xpEarned
    );

    formMessage.textContent = "Activity added.";
    activityForm.reset();

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