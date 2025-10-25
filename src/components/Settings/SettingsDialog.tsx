import { Dispatch, SetStateAction, useEffect, useState } from "react";
import { Config } from "../../../electron/ConfigHelper";
import { useToast } from "../../contexts/toast";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";

type APIProvider = "openai" | "gemini" | "anthropic";

type AIModel = {
	id: string;
	name: string;
	description: string;
};

type ModelCategory = {
	key: "extractionModel" | "solutionModel" | "debuggingModel";
	title: string;
	description: string;
	openaiModels: AIModel[];
	geminiModels: AIModel[];
	anthropicModels: AIModel[];
};

// Define available models for each category
const modelCategories: ModelCategory[] = [
	{
		key: "extractionModel",
		title: "Problem Extraction",
		description: "Model used to analyze screenshots and extract problem details",
		openaiModels: [
			{
				id: "gpt-4o",
				name: "gpt-4o",
				description: "Best overall performance for problem extraction",
			},
			{
				id: "gpt-4o-mini",
				name: "gpt-4o-mini",
				description: "Faster, more cost-effective option",
			},
		],
		geminiModels: [
			{
				id: "gemini-1.5-pro",
				name: "Gemini 1.5 Pro",
				description: "Best overall performance for problem extraction",
			},
			{
				id: "gemini-2.0-flash",
				name: "Gemini 2.0 Flash",
				description: "Faster, more cost-effective option",
			},
		],
		anthropicModels: [
			{
				id: "claude-3-7-sonnet-20250219",
				name: "Claude 3.7 Sonnet",
				description: "Best overall performance for problem extraction",
			},
			{
				id: "claude-3-5-sonnet-20241022",
				name: "Claude 3.5 Sonnet",
				description: "Balanced performance and speed",
			},
			{
				id: "claude-3-opus-20240229",
				name: "Claude 3 Opus",
				description: "Top-level intelligence, fluency, and understanding",
			},
		],
	},
	{
		key: "solutionModel",
		title: "Solution Generation",
		description: "Model used to generate coding solutions",
		openaiModels: [
			{
				id: "gpt-4o",
				name: "gpt-4o",
				description: "Strong overall performance for coding tasks",
			},
			{
				id: "gpt-4o-mini",
				name: "gpt-4o-mini",
				description: "Faster, more cost-effective option",
			},
		],
		geminiModels: [
			{
				id: "gemini-1.5-pro",
				name: "Gemini 1.5 Pro",
				description: "Strong overall performance for coding tasks",
			},
			{
				id: "gemini-2.0-flash",
				name: "Gemini 2.0 Flash",
				description: "Faster, more cost-effective option",
			},
		],
		anthropicModels: [
			{
				id: "claude-3-7-sonnet-20250219",
				name: "Claude 3.7 Sonnet",
				description: "Strong overall performance for coding tasks",
			},
			{
				id: "claude-3-5-sonnet-20241022",
				name: "Claude 3.5 Sonnet",
				description: "Balanced performance and speed",
			},
			{
				id: "claude-3-opus-20240229",
				name: "Claude 3 Opus",
				description: "Top-level intelligence, fluency, and understanding",
			},
		],
	},
	{
		key: "debuggingModel",
		title: "Debugging",
		description: "Model used to debug and improve solutions",
		openaiModels: [
			{
				id: "gpt-4o",
				name: "gpt-4o",
				description: "Best for analyzing code and error messages",
			},
			{
				id: "gpt-4o-mini",
				name: "gpt-4o-mini",
				description: "Faster, more cost-effective option",
			},
		],
		geminiModels: [
			{
				id: "gemini-1.5-pro",
				name: "Gemini 1.5 Pro",
				description: "Best for analyzing code and error messages",
			},
			{
				id: "gemini-2.0-flash",
				name: "Gemini 2.0 Flash",
				description: "Faster, more cost-effective option",
			},
		],
		anthropicModels: [
			{
				id: "claude-3-7-sonnet-20250219",
				name: "Claude 3.7 Sonnet",
				description: "Best for analyzing code and error messages",
			},
			{
				id: "claude-3-5-sonnet-20241022",
				name: "Claude 3.5 Sonnet",
				description: "Balanced performance and speed",
			},
			{
				id: "claude-3-opus-20240229",
				name: "Claude 3 Opus",
				description: "Top-level intelligence, fluency, and understanding",
			},
		],
	},
];

interface SettingsDialogProps {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}

interface ApiKeySectionProps {
	openaiKey: string;
	setOpenaiKey: Dispatch<SetStateAction<string>>;
	geminiKey: string;
	setGeminiKey: Dispatch<SetStateAction<string>>;
	anthropicKey: string;
	setAnthropicKey: Dispatch<SetStateAction<string>>;
	apiProvider: APIProvider;
}

export function SettingsDialog({ open: externalOpen, onOpenChange }: SettingsDialogProps) {
	const [open, setOpen] = useState(externalOpen || false);
	const [openaiKey, setOpenaiKey] = useState("");
	const [geminiKey, setGeminiKey] = useState("");
	const [anthropicKey, setAnthropicKey] = useState("");
	const [apiProvider, setApiProvider] = useState<APIProvider>("openai");
	const [extractionModel, setExtractionModel] = useState("gpt-4o");
	const [solutionModel, setSolutionModel] = useState("gpt-4o");
	const [debuggingModel, setDebuggingModel] = useState("gpt-4o");
	const [isLoading, setIsLoading] = useState(false);
	const { showToast } = useToast();

	// Sync with external open state
	useEffect(() => {
		if (externalOpen !== undefined) {
			setOpen(externalOpen);
		}
	}, [externalOpen]);

	// Handle open state changes
	const handleOpenChange = (newOpen: boolean) => {
		setOpen(newOpen);
		// Only call onOpenChange when there's actually a change
		if (onOpenChange && newOpen !== externalOpen) {
			onOpenChange(newOpen);
		}
	};

	// Load current config on dialog open
	useEffect(() => {
		if (open) {
			setIsLoading(true);

			window.electronAPI
				.getConfig()
				.then((config: Config) => {
					setOpenaiKey(config.openaiApiKey || "");
					setGeminiKey(config.geminiApiKey || "");
					setAnthropicKey(config.anthropicApiKey || "");
					setApiProvider(config.apiProvider || "openai");
					setExtractionModel(config.extractionModel || "gpt-4o");
					setSolutionModel(config.solutionModel || "gpt-4o");
					setDebuggingModel(config.debuggingModel || "gpt-4o");
				})
				.catch((error: unknown) => {
					console.error("Failed to load config:", error);
					showToast("Error", "Failed to load settings", "error");
				})
				.finally(() => {
					setIsLoading(false);
				});
		}
	}, [open, showToast]);

	// Handle API provider change
	const handleProviderChange = (provider: APIProvider) => {
		setApiProvider(provider);

		// Reset models to defaults when changing provider
		if (provider === "openai") {
			setExtractionModel("gpt-4o");
			setSolutionModel("gpt-4o");
			setDebuggingModel("gpt-4o");
		} else if (provider === "gemini") {
			setExtractionModel("gemini-1.5-pro");
			setSolutionModel("gemini-1.5-pro");
			setDebuggingModel("gemini-1.5-pro");
		} else if (provider === "anthropic") {
			setExtractionModel("claude-3-7-sonnet-20250219");
			setSolutionModel("claude-3-7-sonnet-20250219");
			setDebuggingModel("claude-3-7-sonnet-20250219");
		}
	};

	const handleSave = async () => {
		setIsLoading(true);
		try {
			const result = await window.electronAPI.updateConfig({
				openaiApiKey: openaiKey,
				geminiApiKey: geminiKey,
				anthropicApiKey: anthropicKey,
				apiProvider,
				extractionModel,
				solutionModel,
				debuggingModel,
			});

			if (result) {
				showToast("Success", "Settings saved successfully", "success");
				handleOpenChange(false);

				// Force reload the app to apply the API key
				setTimeout(() => {
					window.location.reload();
				}, 1500);
			}
		} catch (error) {
			console.error("Failed to save settings:", error);
			showToast("Error", "Failed to save settings", "error");
		} finally {
			setIsLoading(false);
		}
	};

	const getActiveKey = () => {
		switch (apiProvider) {
			case "openai":
				return openaiKey;
			case "gemini":
				return geminiKey;
			case "anthropic":
				return anthropicKey;
			default:
				return "";
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent
				className="sm:max-w-md bg-black border border-white/10 text-white settings-dialog"
				style={{
					position: "fixed",
					top: "50%",
					left: "50%",
					transform: "translate(-50%, -50%)",
					width: "min(450px, 90vw)",
					height: "auto",
					minHeight: "400px",
					maxHeight: "90vh",
					overflowY: "auto",
					zIndex: 9999,
					margin: 0,
					padding: "20px",
					transition: "opacity 0.25s ease, transform 0.25s ease",
					animation: "fadeIn 0.25s ease forwards",
					opacity: 0.98,
				}}
			>
				<DialogHeader>
					<DialogTitle>API Settings</DialogTitle>
					<DialogDescription className="text-white/70">
						Configure your API key and model preferences. You'll need your own API key to use this application.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4 py-4">
					{/* API Provider Selection */}
					<div className="space-y-2">
						<label className="text-sm font-medium text-white">API Provider</label>
						<div className="flex gap-2">
							{(["openai", "gemini", "anthropic"] as const).map((provider) => (
								<div
									key={provider}
									className={`flex-1 p-2 rounded-lg cursor-pointer transition-colors ${
										apiProvider === provider
											? "bg-white/10 border border-white/20"
											: "bg-black/30 border border-white/5 hover:bg-white/5"
									}`}
									onClick={() => handleProviderChange(provider)}
								>
									<div className="flex items-center gap-2">
										<div className={`w-3 h-3 rounded-full ${apiProvider === provider ? "bg-white" : "bg-white/20"}`} />
										<div className="flex flex-col">
											<p className="font-medium text-white text-sm">
												{provider === "openai" ? "OpenAI" : provider === "gemini" ? "Gemini" : "Claude"}
											</p>
											<p className="text-xs text-white/60">
												{provider === "openai"
													? "GPT-4o models"
													: provider === "gemini"
														? "Gemini 1.5 models"
														: "Claude 3 models"}
											</p>
										</div>
									</div>
								</div>
							))}
						</div>
					</div>

					<div className="space-y-2">
						<ApiKeySection
							openaiKey={openaiKey}
							geminiKey={geminiKey}
							anthropicKey={anthropicKey}
							setOpenaiKey={setOpenaiKey}
							setGeminiKey={setGeminiKey}
							setAnthropicKey={setAnthropicKey}
							apiProvider={apiProvider}
						/>
					</div>

					<div className="space-y-2 mt-4">
						<label className="text-sm font-medium text-white mb-2 block">Keyboard Shortcuts</label>
						<div className="bg-black/30 border border-white/10 rounded-lg p-3">
							<div className="grid grid-cols-2 gap-y-2 text-xs">
								{[
									["Toggle Visibility", "Ctrl+B / Cmd+B"],
									["Take Screenshot", "Ctrl+H / Cmd+H"],
									["Process Screenshots", "Ctrl+Enter / Cmd+Enter"],
									["Delete Last Screenshot", "Ctrl+L / Cmd+L"],
									["Reset View", "Ctrl+R / Cmd+R"],
									["Quit Application", "Ctrl+Q / Cmd+Q"],
									["Move Window", "Ctrl+Arrow Keys"],
									["Decrease Opacity", "Ctrl+[ / Cmd+["],
									["Increase Opacity", "Ctrl+] / Cmd+]"],
									["Zoom Out", "Ctrl+- / Cmd+-"],
									["Reset Zoom", "Ctrl+0 / Cmd+0"],
									["Zoom In", "Ctrl+= / Cmd+="],
								].map(([label, shortcut], i) => (
									<div key={i}>
										<div className="text-white/70">{label}</div>
										<div className="text-white/90 font-mono">{shortcut}</div>
									</div>
								))}
							</div>
						</div>
					</div>

					<div className="space-y-4 mt-4">
						<label className="text-sm font-medium text-white">AI Model Selection</label>
						<p className="text-xs text-white/60 -mt-3 mb-2">Select which models to use for each stage of the process</p>

						{modelCategories.map((category) => {
							// Get the appropriate model list based on selected provider
							const models =
								apiProvider === "openai"
									? category.openaiModels
									: apiProvider === "gemini"
										? category.geminiModels
										: category.anthropicModels;

							return (
								<div key={category.key} className="mb-4">
									<label className="text-sm font-medium text-white mb-1 block">{category.title}</label>
									<p className="text-xs text-white/60 mb-2">{category.description}</p>

									<div className="space-y-2">
										{models.map((m) => {
											// Determine which state to use based on category key
											const currentValue =
												category.key === "extractionModel"
													? extractionModel
													: category.key === "solutionModel"
														? solutionModel
														: debuggingModel;

											// Determine which setter function to use
											const setValue =
												category.key === "extractionModel"
													? setExtractionModel
													: category.key === "solutionModel"
														? setSolutionModel
														: setDebuggingModel;

											return (
												<div
													key={m.id}
													className={`p-2 rounded-lg cursor-pointer transition-colors ${
														currentValue === m.id
															? "bg-white/10 border border-white/20"
															: "bg-black/30 border border-white/5 hover:bg-white/5"
													}`}
													onClick={() => setValue(m.id)}
												>
													<div className="flex items-center gap-2">
														<div
															className={`w-3 h-3 rounded-full ${currentValue === m.id ? "bg-white" : "bg-white/20"}`}
														/>
														<div>
															<p className="font-medium text-white text-xs">{m.name}</p>
															<p className="text-xs text-white/60">{m.description}</p>
														</div>
													</div>
												</div>
											);
										})}
									</div>
								</div>
							);
						})}
					</div>
				</div>
				<DialogFooter className="flex justify-between sm:justify-between">
					<Button
						variant="outline"
						onClick={() => handleOpenChange(false)}
						className="border-white/10 hover:bg-white/5 text-white"
					>
						Cancel
					</Button>
					<Button
						className="px-4 py-3 bg-white text-black rounded-xl font-medium hover:bg-white/90 transition-colors"
						onClick={handleSave}
						disabled={isLoading || !getActiveKey()}
					>
						{isLoading ? "Saving..." : "Save Settings"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function ApiKeySection({
	openaiKey,
	setOpenaiKey,
	geminiKey,
	setGeminiKey,
	anthropicKey,
	setAnthropicKey,
	apiProvider,
}: ApiKeySectionProps) {
	const keyMap = {
		openai: { key: openaiKey, setKey: setOpenaiKey, label: "OpenAI API Key", placeholder: "sk-..." },
		gemini: {
			key: geminiKey,
			setKey: setGeminiKey,
			label: "Gemini API Key",
			placeholder: "Enter your Gemini API key",
		},
		anthropic: { key: anthropicKey, setKey: setAnthropicKey, label: "Anthropic API Key", placeholder: "sk-ant-..." },
	};

	const { key, setKey, label, placeholder } = keyMap[apiProvider];

	const links =
		apiProvider === "openai"
			? [
					{ text: "OpenAI", url: "https://platform.openai.com/signup" },
					{ text: "API Keys", url: "https://platform.openai.com/api-keys" },
				]
			: apiProvider === "gemini"
				? [
						{ text: "Google AI Studio", url: "https://aistudio.google.com/" },
						{ text: "API Keys", url: "https://aistudio.google.com/app/apikey" },
					]
				: [
						{ text: "Anthropic", url: "https://console.anthropic.com/signup" },
						{ text: "API Keys", url: "https://console.anthropic.com/settings/keys" },
					];

	// Mask API key for display
	const maskApiKey = (key: string) => {
		if (!key || key.length < 10) return "";
		return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
	};

	// Open external link handler
	const openExternalLink = (url: string) => {
		window.electronAPI.openLink(url);
	};

	return (
		<>
			<label className="text-sm font-medium text-white" htmlFor="apiKey">
				{label}
			</label>
			<Input
				id="apiKey"
				value={key}
				type="password"
				placeholder={placeholder}
				onChange={(e) => setKey(e.target.value)}
				className="bg-black/50 border-white/10 text-white"
			/>
			{key && <p className="text-xs text-white/50">Current: {maskApiKey(key)}</p>}
			<p className="text-xs text-white/50">
				Your API key is stored locally and never sent to any server except{" "}
				{apiProvider === "openai" ? "OpenAI" : apiProvider === "gemini" ? "Google" : "Anthropic"}
			</p>
			<div className="mt-2 p-2 rounded-md bg-white/5 border border-white/10">
				<p className="text-xs text-white/80 mb-1">Don't have an API key?</p>
				<p className="text-xs text-white/60 mb-1">
					1. Create an account at{" "}
					<button
						onClick={() => openExternalLink(links[0].url)}
						className="text-blue-400 hover:underline cursor-pointer"
					>
						{links[0].text}
					</button>
				</p>
				<p className="text-xs text-white/60 mb-1">
					2. Go to the{" "}
					<button
						onClick={() => openExternalLink(links[1].url)}
						className="text-blue-400 hover:underline cursor-pointer"
					>
						{links[1].text}
					</button>{" "}
					section
				</p>
				<p className="text-xs text-white/60">3. Create a new API key and paste it here</p>
			</div>
		</>
	);
}
