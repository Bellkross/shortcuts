function searchFallback(text, disposition) {
    console.log("Fallback search for text:", text, "disposition:", disposition);

    // Map omnibox disposition values to Chrome search API values
    let searchDisposition;
    switch (disposition) {
        case "currentTab":
            searchDisposition = "CURRENT_TAB";
            break;
        case "newForegroundTab":
            searchDisposition = "NEW_TAB";
            break;
        case "newBackgroundTab":
            searchDisposition = "NEW_TAB"; // Chrome search API doesn't support background tabs
            break;
        default:
            searchDisposition = "NEW_TAB";
    }

    // Use Chrome's built-in search functionality
    try {
        chrome.search.query({
            text: text,
            disposition: searchDisposition
        });
    } catch (error) {
        console.error("Chrome search failed, falling back to manual search:", error);
        // Fallback: create a search using the omnibox approach
        chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
            if (tabs && tabs.length > 0) {
                chrome.tabs
                    .update(tabs[0].id, {
                        url: `chrome://newtab/`
                    })
                    .then(() => {
                        // After navigating to new tab, we can't directly trigger search
                        // This is a limitation of Chrome's API
                        console.log("Opened new tab for manual search");
                    });
            }
        });
    }
}

// Function to load search engines from bookmarks
function loadSearchEngines() {
    return chrome.bookmarks
        .search({ title: "myshortcuts" })
        .then((folders) => {
            const myshortcutsFolder = folders.find((item) => item.url === undefined);

            if (!myshortcutsFolder) {
                console.log("No myshortcuts folder found, no search engines available");
                return [];
            }

            return chrome.bookmarks.getChildren(myshortcutsFolder.id);
        })
        .then((subFolders) => {
            if (!subFolders) {
                return [];
            }

            const searchEngineFolder = subFolders.find(
                (item) => item.url === undefined && item.title === "search-engines"
            );

            if (!searchEngineFolder) {
                console.log(
                    "No search-engines folder found under myshortcuts, no search engines available"
                );
                return [];
            }

            return chrome.bookmarks.getChildren(searchEngineFolder.id);
        })
        .then((bookmarks) => {
            if (!bookmarks) {
                return [];
            }

            const searchEngines = [];

            for (const bookmark of bookmarks) {
                if (!bookmark.url || !bookmark.url.includes("%s")) continue;

                // Use bookmark title as both display name and search alias
                // Convert title to lowercase for alias (e.g., "Google" -> "google")
                const displayName = bookmark.title.trim();
                const alias = displayName.toLowerCase();

                searchEngines.push({
                    names: [alias],
                    url: bookmark.url,
                    displayName
                });
            }

            console.log(
                `Loaded ${searchEngines.length} search engines from bookmarks: `,
                searchEngines
            );
            return searchEngines;
        })
        .catch((error) => {
            console.error("Error loading search engines from bookmarks:", error);
            return [];
        });
}

// Fuzzy matching function for faster bookmark searching
function matchesSearch(title, searchText) {
    const titleLower = title.toLowerCase();
    const searchLower = searchText.toLowerCase();

    // Exact match (highest priority)
    if (titleLower === searchLower) return true;

    // Starts with search text
    if (titleLower.startsWith(searchLower)) return true;

    // Contains the search text
    if (titleLower.includes(searchLower)) return true;

    // Fuzzy match - all characters in search appear in order in title
    let searchIndex = 0;
    for (let i = 0; i < titleLower.length && searchIndex < searchLower.length; i++) {
        if (titleLower[i] != searchLower[searchIndex]) {
            break;
        }
        searchIndex++;
    }
    return searchIndex === searchLower.length;
}

// Handle omnibox input
chrome.omnibox.onInputChanged.addListener((text, suggest) => {
    console.log("Omnibox input:", text);

    if (!text.trim()) {
        return;
    }

    // Suggest search engine options
    loadSearchEngines().then((engines) => {
        for (const engine of engines) {
            for (const name of engine.names) {
                if (!text.startsWith(name + " ")) {
                    continue;
                }
                const query = text.substring(name.length + 1);
                const suggestions = [
                    {
                        content: name,
                        description: `[Selected] Search ${engine.displayName} for "${query}"`
                    }
                ];
                console.log(`Suggesting search engine: ${engine.displayName} for query "${query}"`);
                suggest(suggestions);
                return;
            }
        }

        chrome.bookmarks
            .search({ title: "myshortcuts" })
            .then((existingFolders) => {
                const myshortcutsFolder = existingFolders.find((item) => item.url === undefined);

                if (!myshortcutsFolder) {
                    return;
                }

                return chrome.bookmarks.getChildren(myshortcutsFolder.id);
            })
            .then((subFolders) => {
                if (!subFolders) {
                    return;
                }

                const shortcutsFolder = subFolders.find(
                    (item) => item.url === undefined && item.title === "shortcuts"
                );

                if (!shortcutsFolder) {
                    return;
                }

                return chrome.bookmarks.getChildren(shortcutsFolder.id);
            })
            .then((bookmarks) => {
                if (!bookmarks) {
                    return;
                }

                const suggestions = bookmarks
                    .filter((bookmark) => bookmark.url && matchesSearch(bookmark.title, text))
                    .sort((a, b) => {
                        // Prioritize exact matches first
                        const aExact = a.title.toLowerCase() === text.toLowerCase();
                        const bExact = b.title.toLowerCase() === text.toLowerCase();
                        if (aExact && !bExact) return -1;
                        if (!aExact && bExact) return 1;

                        // Then prioritize matches at the beginning
                        const aStartsWith = a.title.toLowerCase().startsWith(text.toLowerCase());
                        const bStartsWith = b.title.toLowerCase().startsWith(text.toLowerCase());
                        if (aStartsWith && !bStartsWith) return -1;
                        if (!aStartsWith && bStartsWith) return 1;

                        // Then by length (shorter first)
                        return a.title.length - b.title.length;
                    })
                    .slice(0, 9) // Limit to 9 suggestions
                    .map((bookmark, index) => ({
                        content: bookmark.title, // Use bookmark title instead of URL for faster typing
                        description: `${index === 0 ? "[Selected] " : ""}${
                            bookmark.title
                        } - ${bookmark.url.replace(/&/g, "&amp;")}` // Escape & for XML safety
                    }));

                // Always add default search as last option
                suggestions.push({
                    content: `${text}`,
                    description: `Search for "${text}"`
                });

                suggest(suggestions);
            })
            .catch((error) => {
                console.error("Error searching bookmarks:", error);
            });
    });
});

// Handle omnibox selection
chrome.omnibox.onInputEntered.addListener((text, disposition) => {
    console.log("Omnibox entered:", text, disposition);

    if (text.startsWith("http://") || text.startsWith("https://")) {
        switch (disposition) {
            case "currentTab":
                chrome.tabs.update({ url: text });
                break;
            case "newForegroundTab":
                chrome.tabs.create({ url: text });
                break;
            case "newBackgroundTab":
                chrome.tabs.create({ url: text, active: false });
                break;
        }
        return;
    }

    loadSearchEngines().then((engines) => {
        for (const engine of engines) {
            for (const name of engine.names) {
                if (!text.startsWith(name + " ")) {
                    continue;
                }
                const searchUrl = engine.url.replace(
                    "%s",
                    encodeURIComponent(text.substring(name.length + 1))
                );
                switch (disposition) {
                    case "currentTab":
                        chrome.tabs.update({ url: searchUrl });
                        break;
                    case "newForegroundTab":
                        chrome.tabs.create({ url: searchUrl });
                        break;
                    case "newBackgroundTab":
                        chrome.tabs.create({ url: searchUrl, active: false });
                        break;
                }
                return;
            }
        }

        chrome.bookmarks
            .search({ title: "myshortcuts" })
            .then((existingFolders) => {
                const myshortcutsFolder = existingFolders.find((item) => item.url === undefined);

                if (!myshortcutsFolder) {
                    searchFallback(text, disposition);
                    return;
                }

                return chrome.bookmarks.getChildren(myshortcutsFolder.id);
            })
            .then((subFolders) => {
                if (!subFolders) {
                    searchFallback(text, disposition);
                    return;
                }

                const shortcutsFolder = subFolders.find(
                    (item) => item.url === undefined && item.title === "shortcuts"
                );

                if (!shortcutsFolder) {
                    searchFallback(text, disposition);
                    return;
                }

                return chrome.bookmarks.getChildren(shortcutsFolder.id);
            })
            .then((bookmarks) => {
                if (!bookmarks || bookmarks.length === 0) {
                    searchFallback(text, disposition);
                    return;
                }

                const matchedBookmarks = bookmarks
                    .filter((bookmark) => bookmark.url && matchesSearch(bookmark.title, text))
                    .sort((a, b) => {
                        // Prioritize exact matches first
                        const aExact = a.title.toLowerCase() === text.toLowerCase();
                        const bExact = b.title.toLowerCase() === text.toLowerCase();
                        if (aExact && !bExact) return -1;
                        if (!aExact && bExact) return 1;

                        // Then prioritize matches at the beginning
                        const aStartsWith = a.title.toLowerCase().startsWith(text.toLowerCase());
                        const bStartsWith = b.title.toLowerCase().startsWith(text.toLowerCase());
                        if (aStartsWith && !bStartsWith) return -1;
                        if (!aStartsWith && bStartsWith) return 1;

                        // Then by length (shorter first)
                        return a.title.length - b.title.length;
                    });

                const matchedBookmark = matchedBookmarks[0]; // Take the first (best) match

                if (matchedBookmark) {
                    const url = matchedBookmark.url;
                    switch (disposition) {
                        case "currentTab":
                            chrome.tabs.update({ url: url });
                            break;
                        case "newForegroundTab":
                            chrome.tabs.create({ url: url });
                            break;
                        case "newBackgroundTab":
                            chrome.tabs.create({ url: url, active: false });
                            break;
                    }
                } else {
                    searchFallback(text, disposition);
                }
            })
            .catch((error) => {
                console.error("Error finding bookmark:", error);
                searchFallback(text, disposition);
            });
    });
});

// Initialize shortcuts on extension startup
chrome.runtime.onStartup.addListener(() => {
    console.log("Extension started");
    initializeFolderStructure();
});

chrome.runtime.onInstalled.addListener(() => {
    console.log("Extension installed");
    initializeFolderStructure();
});

// Function to initialize the required folder structure
function initializeFolderStructure() {
    chrome.bookmarks
        .search({ title: "myshortcuts" })
        .then((existingFolders) => {
            const myshortcutsFolder = existingFolders.find((item) => item.url === undefined);

            if (!myshortcutsFolder) {
                console.log("myshortcuts folder not found, creating complete folder structure");
                return createCompleteStructure();
            }

            console.log("Found existing myshortcuts folder:", myshortcutsFolder.id);
            return ensureSubfolders(myshortcutsFolder.id);
        })
        .then(() => {
            console.log("Folder structure initialization completed successfully");
        })
        .catch((error) => {
            console.error("Error initializing folder structure:", error);
        });
}

// Helper function to ensure subfolders exist
function ensureSubfolders(parentId) {
    return chrome.bookmarks.getChildren(parentId).then((subFolders) => {
        const shortcutsFolder = subFolders.find(
            (item) => item.url === undefined && item.title === "shortcuts"
        );
        const searchEnginesFolder = subFolders.find(
            (item) => item.url === undefined && item.title === "search-engines"
        );

        const promises = [];

        if (!shortcutsFolder) {
            promises.push(
                chrome.bookmarks.create({
                    parentId: parentId,
                    title: "shortcuts"
                }).then((newFolder) => {
                    console.log("Created shortcuts folder:", newFolder.id);
                })
            );
        } else {
            console.log("Found existing shortcuts folder:", shortcutsFolder.id);
        }

        if (!searchEnginesFolder) {
            promises.push(
                chrome.bookmarks.create({
                    parentId: parentId,
                    title: "search-engines"
                }).then((newFolder) => {
                    console.log("Created search-engines folder:", newFolder.id);
                })
            );
        } else {
            console.log("Found existing search-engines folder:", searchEnginesFolder.id);
        }

        return Promise.all(promises);
    });
}

// Helper function to create complete folder structure
function createCompleteStructure() {
    return chrome.bookmarks.getTree().then((bookmarkBar) => {
        const bookmarksBarFolder = bookmarkBar[0].children.find(
            (child) => child.title === "Bookmarks bar"
        );

        if (!bookmarksBarFolder) {
            throw new Error("Bookmarks bar not found");
        }

        return chrome.bookmarks
            .create({
                parentId: bookmarksBarFolder.id,
                title: "myshortcuts"
            })
            .then((myshortcutsFolder) => {
                console.log("Created new myshortcuts folder:", myshortcutsFolder.id);

                // Create both shortcuts and search-engines subfolders
                const promises = [
                    chrome.bookmarks.create({
                        parentId: myshortcutsFolder.id,
                        title: "shortcuts"
                    }).then((shortcutsFolder) => {
                        console.log("Created new shortcuts folder:", shortcutsFolder.id);
                    }),
                    chrome.bookmarks.create({
                        parentId: myshortcutsFolder.id,
                        title: "search-engines"
                    }).then((searchEnginesFolder) => {
                        console.log("Created new search-engines folder:", searchEnginesFolder.id);
                    })
                ];

                return Promise.all(promises);
            });
    });
}

// Handle keyboard commands
chrome.commands.onCommand.addListener((command, tab) => {
    console.log("Command received:", command, tab);
    switch (command) {
        case "add-shortcut":
            handleAddShortcut(tab)
                .then(() => {
                    console.log("Custom shortcut handling completed");
                })
                .catch((error) => {
                    console.error("Error handling custom shortcut:", error);
                });
            break;
    }
});

// Function to handle adding custom shortcut via keyboard
function handleAddShortcut() {
    return new Promise((resolve, reject) => {
        console.log("handleAddShortcut started");
        chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
            if (!tabs || tabs.length === 0) {
                reject(new Error("No active tab found"));
                return;
            }
            const tab = tabs[0];
            if (!tab.url) {
                reject(new Error("Tab has no URL"));
                return;
            }
            console.log("Found tab url:", {
                url: tab.url
            });

            // Open the popup to let user input custom name
            chrome.action
                .openPopup()
                .then(() => {
                    console.log("Popup opened successfully");
                    resolve();
                })
                .catch((error) => {
                    console.error("Failed to open popup:", error);
                    reject(error);
                });
        });
    });
}

// Function to find or create "shortcuts" bookmark folder under myshortcuts
function findOrCreateShortcutsFolder() {
    return chrome.bookmarks
        .search({ title: "myshortcuts" })
        .then((existingFolders) => {
            const myshortcutsFolder = existingFolders.find((item) => item.url === undefined);

            if (!myshortcutsFolder) {
                // Create myshortcuts folder in bookmarks bar, then create shortcuts subfolder
                return createMyshortcutsFolderWithShortcuts();
            }

            // Check if shortcuts folder exists under myshortcuts
            return chrome.bookmarks.getChildren(myshortcutsFolder.id).then((subFolders) => {
                const shortcutsFolder = subFolders.find(
                    (item) => item.url === undefined && item.title === "shortcuts"
                );

                if (shortcutsFolder) {
                    console.log("Found existing shortcuts folder:", shortcutsFolder.id);
                    return shortcutsFolder.id;
                }

                // Create shortcuts folder under myshortcuts
                return chrome.bookmarks
                    .create({
                        parentId: myshortcutsFolder.id,
                        title: "shortcuts"
                    })
                    .then((newFolder) => {
                        console.log("Created new shortcuts folder:", newFolder.id);
                        return newFolder.id;
                    });
            });
        })
        .catch((error) => {
            console.error("Error finding/creating shortcuts folder:", error);
            throw error; // Re-throw the error to fail the whole operation
        });
}

// Helper function to create myshortcuts folder with shortcuts subfolder
function createMyshortcutsFolderWithShortcuts() {
    return chrome.bookmarks.getTree().then((bookmarkBar) => {
        const bookmarksBarFolder = bookmarkBar[0].children.find(
            (child) => child.title === "Bookmarks bar"
        );

        if (!bookmarksBarFolder) {
            throw new Error("Bookmarks bar not found");
        }

        return chrome.bookmarks
            .create({
                parentId: bookmarksBarFolder.id,
                title: "myshortcuts"
            })
            .then((myshortcutsFolder) => {
                console.log("Created new myshortcuts folder:", myshortcutsFolder.id);

                // Create shortcuts subfolder
                return chrome.bookmarks
                    .create({
                        parentId: myshortcutsFolder.id,
                        title: "shortcuts"
                    })
                    .then((shortcutsFolder) => {
                        console.log("Created new shortcuts folder:", shortcutsFolder.id);
                        return shortcutsFolder.id;
                    });
            });
    });
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
        case "checkDuplicate":
            // Check if current URL is already bookmarked
            chrome.tabs
                .query({ active: true, currentWindow: true })
                .then((tabs) => {
                    // Search for existing myshortcuts folder
                    return chrome.bookmarks
                        .search({ title: "myshortcuts" })
                        .then((existingFolders) => {
                            const myshortcutsFolder = existingFolders.find(
                                (item) => item.url === undefined
                            );

                            if (!myshortcutsFolder) {
                                sendResponse({ isDuplicate: false });
                                return;
                            }

                            return chrome.bookmarks.getChildren(myshortcutsFolder.id);
                        })
                        .then((subFolders) => {
                            if (!subFolders) {
                                sendResponse({ isDuplicate: false });
                                return;
                            }

                            const shortcutsFolder = subFolders.find(
                                (item) => item.url === undefined && item.title === "shortcuts"
                            );

                            if (!shortcutsFolder) {
                                sendResponse({ isDuplicate: false });
                                return;
                            }

                            return chrome.bookmarks.getChildren(shortcutsFolder.id);
                        })
                        .then((bookmarks) => {
                            if (!bookmarks) {
                                sendResponse({ isDuplicate: false });
                                return;
                            }

                            const existingBookmark = bookmarks.find(
                                (bookmark) => bookmark.title === request.shortcutName
                            );

                            if (existingBookmark) {
                                sendResponse({
                                    isDuplicate: true,
                                    existingBookmark: {
                                        title: existingBookmark.title,
                                        url: existingBookmark.url,
                                        id: existingBookmark.id
                                    }
                                });
                            } else {
                                sendResponse({ isDuplicate: false });
                            }
                        });
                })
                .catch((error) => {
                    console.error("Error checking duplicate:", error);
                    sendResponse({ error: error.message });
                });
            break;
        case "saveShortcut":
            console.log("Received shortcut:", request.shortcutName);

            // Fetch current tab link
            chrome.tabs
                .query({ active: true, currentWindow: true })
                .then((tabs) => {
                    if (!tabs || tabs.length === 0) {
                        sendResponse({ error: "No active tab found" });
                        return;
                    }

                    const tab = tabs[0];
                    if (!tab.url) {
                        sendResponse({ error: "Tab has no URL" });
                        return;
                    }

                    console.log(`Shortcut received and link is as follows: ${tab.url}`);

                    // Find or create "shortcuts" folder, then check for duplicates before saving
                    findOrCreateShortcutsFolder()
                        .then((folderId) => {
                            // Check for existing bookmarks with the same name
                            return chrome.bookmarks
                                .getChildren(folderId)
                                .then((existingBookmarks) => {
                                    const existingBookmark = existingBookmarks.find(
                                        (bookmark) => bookmark.title === request.shortcutName
                                    );

                                    if (existingBookmark) {
                                        // Name already exists, send back the existing bookmark info
                                        sendResponse({
                                            error: "duplicate",
                                            existingBookmark: {
                                                title: existingBookmark.title,
                                                url: existingBookmark.url,
                                                id: existingBookmark.id
                                            },
                                            message: `Name already used: "${existingBookmark.title}"`
                                        });
                                        return null; // Don't create new bookmark
                                    }

                                    // No duplicate found, create new bookmark
                                    return chrome.bookmarks.create({
                                        parentId: folderId,
                                        title: request.shortcutName,
                                        url: existingBookmark.url 
                                    });
                                });
                        })
                        .then((bookmark) => {
                            if (bookmark) {
                                // New bookmark created successfully
                                console.log(
                                    "Bookmark created successfully in shortcuts folder:",
                                    bookmark
                                );
                                sendResponse({
                                    url: tab.url,
                                    message: "Shortcut saved as bookmark in shortcuts folder",
                                    bookmarkId: bookmark.id
                                });
                            }
                            // If bookmark is null, it means duplicate was found and response already sent
                        })
                        .catch((error) => {
                            console.error("Error creating bookmark:", error);
                            sendResponse({ error: "Failed to create bookmark: " + error.message });
                        });
                })
                .catch((error) => {
                    console.error("Error getting current tab:", error);
                    sendResponse({ error: error.message });
                });
            break;
        default:
            sendResponse({ error: "Unknown action" });
    }

    return true; // Keep message channel open for response
});
