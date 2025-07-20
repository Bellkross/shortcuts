document.addEventListener("DOMContentLoaded", function () {
    // DOM elements
    const customAddBtn = document.getElementById("customAddBtn");
    const shortcutNameInput = document.getElementById("shortcutNameInput");

    // Initialize popup
    init();

    function showDuplicateWarning() {
        // Change button text and disable it
        customAddBtn.textContent = "Duplicate";
        customAddBtn.style.backgroundColor = "#dc3545";
        customAddBtn.style.color = "white";
        customAddBtn.disabled = true; // Disable saving for duplicates
    }

    function clearDuplicateWarning() {
        // Reset button appearance and enable it
        customAddBtn.textContent = "Add Shortcut";
        customAddBtn.style.backgroundColor = "";
        customAddBtn.style.color = "";
        customAddBtn.disabled = false;
    }

    function init() {
        // Focus on the shortcut name input field when popup opens
        shortcutNameInput.focus();

        // Add keyboard event handlers
        shortcutNameInput.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                event.preventDefault();
                // Only trigger click if button is not disabled (not a duplicate)
                if (!customAddBtn.disabled) {
                    customAddBtn.click();
                }
            } else if (event.key === "Escape") {
                event.preventDefault();
                window.close();
            }
        });

        // Clear duplicate warning when user starts typing
        shortcutNameInput.addEventListener("input", function () {
            const shortcutName = shortcutNameInput.value.trim();
            chrome.runtime.sendMessage(
                { action: "checkDuplicate", shortcutName: shortcutName },
                function (response) {
                    if (response && response.isDuplicate) {
                        showDuplicateWarning();
                    } else {
                        clearDuplicateWarning();
                    }
                }
            );
        });
    }

    // Show custom input form
    customAddBtn.addEventListener("click", function () {
        const shortcutName = shortcutNameInput.value.trim();
        if (!shortcutName) {
            alert("Please enter a shortcut name.");
            return;
        }

        // Send runtime message to background script
        chrome.runtime.sendMessage(
            {
                action: "saveShortcut",
                shortcutName: shortcutName
            },
            function (response) {
                if (chrome.runtime.lastError) {
                    console.error("Runtime error:", chrome.runtime.lastError);
                    alert("Runtime error: " + chrome.runtime.lastError.message);
                    return;
                }

                if (response && !response.error) {
                    window.close();
                } else {
                    alert(
                        "Error saving shortcut: " + (response ? response.error : "Unknown error")
                    );
                }
            }
        );
    });
});
