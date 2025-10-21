// Get the platform safely
const getPlatform = () => {
	try {
		return window.electronAPI?.getPlatform() || "win32"; // Default to win32 if API is not available
	} catch {
		return "win32"; // Default to win32 if there's an error
	}
};

// Platform-specific command key symbol
export const COMMAND_KEY = getPlatform() === "darwin" ? "⌘" : "Ctrl";
