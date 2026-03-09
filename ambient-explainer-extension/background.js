chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "explain-selection",
    title: "Explain with JustClarify",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "explain-selection") {
    chrome.tabs.sendMessage(tab.id, { type: "EXPLAIN_SELECTION" });
  }
});
