// ProcessingHelper.ts
import Anthropic, { APIError as ClaudeAPIError } from '@anthropic-ai/sdk'
import { MessageParam as AnthropicMessage } from '@anthropic-ai/sdk/resources/messages'
import * as axios from "axios"
import { BrowserWindow } from "electron"
import fs from "node:fs"
import { OpenAI, APIError as OpenAiAPIError } from "openai"
import { configHelper } from "./ConfigHelper"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { IProcessingHelperDeps } from "./main"

interface GeminiMessage {
  role: string;
  parts: Array<{
    text?: string;
    inlineData?: {
      mimeType: string;
      data: string;
    }
  }>;
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
    finishReason: string;
  }>;
}

export class ProcessingHelper {
  private deps: IProcessingHelperDeps
  private screenshotHelper: ScreenshotHelper
  private openaiClient: OpenAI | null = null
  private geminiApiKey: string | null = null
  private anthropicClient: Anthropic | null = null

  // AbortControllers for API requests
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps
    this.screenshotHelper = deps.getScreenshotHelper()

    // Initialize AI client based on config
    this.initializeAIClient();

    // Listen for config changes to re-initialize the AI client
    configHelper.on('config-updated', () => {
      this.initializeAIClient();
    });
  }

  /**
   * Initialize or reinitialize the AI client with current config
   */
  private initializeAIClient(): void {
    this.openaiClient = null;
    this.geminiApiKey = null;
    this.anthropicClient = null;

    try {
      const config = configHelper.loadConfig();
      if (!config.apiKey) {
        console.warn(`No API key provided for ${config.apiProvider}. Client not initialized.`);
        return;
      }

      switch (config.apiProvider) {
        case "openai":
          this.openaiClient = new OpenAI({
            apiKey: config.apiKey,
            timeout: 60000,
            maxRetries: 2
          });
          console.log("OpenAI client initialized successfully");
          break;
        case "gemini":
          this.geminiApiKey = config.apiKey;
          console.log("Gemini API key set successfully");
          break;
        case "anthropic":
          this.anthropicClient = new Anthropic({
            apiKey: config.apiKey,
            timeout: 60000,
            maxRetries: 2
          });
          console.log("Anthropic client initialized successfully");
          break;
        default:
          console.warn(`Unsupported API provider: ${config.apiProvider}`);
      }
    } catch (error) {
      console.error("Failed to initialize AI client:", error);
      // Clients are already null
    }
  }

  private async waitForInitialization(
    mainWindow: BrowserWindow
  ): Promise<void> {
    let attempts = 0
    const maxAttempts = 50 // 5 seconds total

    while (attempts < maxAttempts) {
      const isInitialized = await mainWindow.webContents.executeJavaScript(
        "window.__IS_INITIALIZED__"
      )
      if (isInitialized) return
      await new Promise((resolve) => setTimeout(resolve, 100))
      attempts++
    }
    throw new Error("App failed to initialize after 5 seconds")
  }

  private async getLanguage(): Promise<string> {
    try {
      // Get language from config
      const config = configHelper.loadConfig();
      if (config.language) {
        return config.language;
      }

      // Fallback to window variable if config doesn't have language
      const mainWindow = this.deps.getMainWindow()
      if (mainWindow) {
        try {
          await this.waitForInitialization(mainWindow)
          const language = await mainWindow.webContents.executeJavaScript(
            "window.__LANGUAGE__"
          )

          if (
            typeof language === "string" &&
            language !== undefined &&
            language !== null
          ) {
            return language;
          }
        } catch (err) {
          console.warn("Could not get language from window", err);
        }
      }

      // Default fallback
      return "python";
    } catch (error) {
      console.error("Error getting language:", error)
      return "python"
    }
  }

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return

    const config = configHelper.loadConfig();

    // First verify we have a valid AI client
    let isClientValid = true

    if (config.apiProvider === "openai" && !this.openaiClient) {
      this.initializeAIClient();

      if (!this.openaiClient) {
        console.error("OpenAI client not initialized");
        isClientValid = false
      }
    } else if (config.apiProvider === "gemini" && !this.geminiApiKey) {
      this.initializeAIClient();

      if (!this.geminiApiKey) {
        console.error("Gemini API key not initialized");
        isClientValid = false
      }
    } else if (config.apiProvider === "anthropic" && !this.anthropicClient) {
      // Add check for Anthropic client
      this.initializeAIClient();

      if (!this.anthropicClient) {
        console.error("Anthropic client not initialized");
        isClientValid = false
      }
    }

    // If no valid client, send error and exit
    if (!isClientValid) {
      this.sendProcessingEvent('API_KEY_INVALID')
      return;
    }

    const view = this.deps.getView()
    console.log("Processing screenshots in view:", view)

    if (view === "queue") {
      this.sendProcessingEvent('INITIAL_START')
      const screenshotQueue = this.screenshotHelper.getScreenshotQueue()
      console.log("Processing main queue screenshots:", screenshotQueue)

      // Check if the queue is empty
      if (!screenshotQueue || screenshotQueue.length === 0) {
        console.log("No screenshots found in queue");
        this.sendProcessingEvent('NO_SCREENSHOTS')
        return;
      }

      // Check that files actually exist
      const existingScreenshots = screenshotQueue.filter(path => fs.existsSync(path));
      if (existingScreenshots.length === 0) {
        console.log("Screenshot files don't exist on disk");
        this.sendProcessingEvent('NO_SCREENSHOTS')
        return;
      }

      try {
        // Initialize AbortController
        this.currentProcessingAbortController = new AbortController()
        const { signal } = this.currentProcessingAbortController

        const screenshots = await Promise.all(
          existingScreenshots.map(async (path) => {
            try {
              return {
                path,
                preview: await this.screenshotHelper.getImagePreview(path),
                data: fs.readFileSync(path).toString('base64')
              };
            } catch (err) {
              console.error(`Error reading screenshot ${path}:`, err);
              return null;
            }
          })
        )

        // Filter out any nulls from failed screenshots
        const validScreenshots = screenshots.filter(Boolean) as {path: string; preview: string; data: string;}[]

        if (validScreenshots.length === 0) {
          throw new Error("Failed to load screenshot data");
        }

        const result = await this.processScreenshotsHelper(validScreenshots, signal)

        if (!result.success) {
          console.log("Processing failed:", result.error)
          if (result.error?.includes("API Key") || result.error?.includes("OpenAI") || result.error?.includes("Gemini")) {
            this.sendProcessingEvent('API_KEY_INVALID')
          } else {
            this.sendProcessingEvent('INITIAL_SOLUTION_ERROR', result.error)
          }
          // Reset view back to queue on error
          console.log("Resetting view to queue due to error")
          this.deps.setView("queue")
          return
        }

        // Only set view to solutions if processing succeeded
        console.log("Setting view to solutions after successful processing")
        this.sendProcessingEvent('SOLUTION_SUCCESS', result.data)
        this.deps.setView("solutions")
      } catch (error: unknown) {
        let errorMessage = error

        console.error("Processing error:", error)

        if (axios.isCancel(error)) {
          errorMessage = "Processing was canceled by the user."
        } else if (error instanceof Error) {
          errorMessage = error.message || "Server error. Please try again."
        }


        this.sendProcessingEvent('INITIAL_SOLUTION_ERROR', errorMessage)

        // Reset view back to queue on error
        console.log("Resetting view to queue due to error")
        this.deps.setView("queue")
      } finally {
        this.currentProcessingAbortController = null
      }
    } else {
      // view == 'solutions'
      const extraScreenshotQueue =
        this.screenshotHelper.getExtraScreenshotQueue()
      console.log("Processing extra queue screenshots:", extraScreenshotQueue)

      // Check if the extra queue is empty
      if (!extraScreenshotQueue || extraScreenshotQueue.length === 0) {
        console.log("No extra screenshots found in queue");
        this.sendProcessingEvent('NO_SCREENSHOTS')

        return;
      }

      // Check that files actually exist
      const existingExtraScreenshots = extraScreenshotQueue.filter(path => fs.existsSync(path));
      if (existingExtraScreenshots.length === 0) {
        console.log("Extra screenshot files don't exist on disk");
        this.sendProcessingEvent('NO_SCREENSHOTS')
        return;
      }

      this.sendProcessingEvent('DEBUG_START')

      // Initialize AbortController
      this.currentExtraProcessingAbortController = new AbortController()
      const { signal } = this.currentExtraProcessingAbortController

      try {
        // Get all screenshots (both main and extra) for processing
        const allPaths = [
          ...this.screenshotHelper.getScreenshotQueue(),
          ...existingExtraScreenshots
        ];

        const screenshots = await Promise.all(
          allPaths.map(async (path) => {
            try {
              if (!fs.existsSync(path)) {
                console.warn(`Screenshot file does not exist: ${path}`);
                return null;
              }

              return {
                path,
                preview: await this.screenshotHelper.getImagePreview(path),
                data: fs.readFileSync(path).toString('base64')
              };
            } catch (err) {
              console.error(`Error reading screenshot ${path}:`, err);
              return null;
            }
          })
        )

        // Filter out any nulls from failed screenshots
        const validScreenshots = screenshots.filter(Boolean) as {path: string; preview: string; data: string;}[]

        if (validScreenshots.length === 0) {
          throw new Error("Failed to load screenshot data for debugging");
        }

        console.log(
          "Combined screenshots for processing:",
          validScreenshots.map((s) => s.path)
        )

        const result = await this.processExtraScreenshotsHelper(
          validScreenshots,
          signal
        )

        if (result.success) {
          this.deps.setHasDebugged(true)
          this.sendProcessingEvent('DEBUG_SUCCESS')
        } else {
          this.sendProcessingEvent('DEBUG_ERROR', result.error)
        }
      } catch (error: unknown) {
        if (axios.isCancel(error)) {
          this.sendProcessingEvent('DEBUG_ERROR', "Extra processing was canceled by the user.")
        } else if (error instanceof Error) {
          this.sendProcessingEvent('DEBUG_ERROR', error.message)
        }
      } finally {
        this.currentExtraProcessingAbortController = null
      }
    }
  }

  private async processScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    try {
      const language = await this.getLanguage();
      const mainWindow = this.deps.getMainWindow();

      // Step 1: Extract problem info using AI Vision API (OpenAI or Gemini)
      const imageDataList = screenshots.map(screenshot => screenshot.data);

      const prompt = `
Extract the coding problem details from these screenshots. Return in JSON format.
Preferred coding language we gonna use for this problem is ${language}.`;

      const aiResult = await this.callAIModel(prompt, imageDataList, 'extraction', signal);
      if (!aiResult.success) {
        return { success: false, error: aiResult.error };
      }

      const jsonText = aiResult.content!.replace(/```json|```/g, '').trim();
      const problemInfo = JSON.parse(jsonText);

      // Update the user on progress
      this.updateProcessingStatus("Problem analyzed successfully. Preparing to generate solution...", 40)

      // Store problem info in AppState
      this.deps.setProblemInfo(problemInfo);

      // Send first success event
      if (mainWindow) {
        this.sendProcessingEvent('PROBLEM_EXTRACTED', problemInfo)

        // Generate solutions after successful extraction
        const solutionsResult = await this.generateSolutionsHelper(signal);
        if (solutionsResult.success) {
          // Clear any existing extra screenshots before transitioning to solutions view
          this.screenshotHelper.clearExtraScreenshotQueue();

          // Final progress update
          this.updateProcessingStatus("Solution generated successfully", 100)
          this.sendProcessingEvent('SOLUTION_SUCCESS', solutionsResult.data)

          return { success: true, data: solutionsResult.data };
        } else {
          throw new Error(
            solutionsResult.error || "Failed to generate solutions"
          );
        }
      }

      return { success: false, error: "Failed to process screenshots" };
    } catch (error: unknown) {
      let errorMessage = "Failed to process screenshots. Please try again.";

      if (error instanceof Error) {
        errorMessage = error.message;
      }

      console.error("Processing error:", error);
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  private async generateSolutionsHelper(signal: AbortSignal) {
    const problemInfo = this.deps.getProblemInfo();
    const language = await this.getLanguage();

    if (!problemInfo) {
      return {
        success: false,
        error: "No problem info available"
      };
    }

    // Create prompt for solution generation
    const promptText = `
Generate a detailed solution for the following coding problem:

PROBLEM STATEMENT:
${problemInfo.problem_statement}

CONSTRAINTS:
${problemInfo.constraints || "No specific constraints provided."}

EXAMPLE INPUT:
${problemInfo.example_input || "No example input provided."}

EXAMPLE OUTPUT:
${problemInfo.example_output || "No example output provided."}

LANGUAGE: ${language}

I need the response in the following format:
1. Code: A clean, optimized implementation in ${language}
2. Your Thoughts: A list of key insights and reasoning behind your approach
3. Time complexity: O(X) with a detailed explanation (at least 2 sentences)
4. Space complexity: O(X) with a detailed explanation (at least 2 sentences)

For complexity explanations, please be thorough. For example: "Time complexity: O(n) because we iterate through the array only once. This is optimal as we need to examine each element at least once to find the solution." or "Space complexity: O(n) because in the worst case, we store all elements in the hashmap. The additional space scales linearly with the input size."

Your solution should be efficient, well-commented, and handle edge cases.
`;

    const aiResult = await this.callAIModel(promptText, [], 'solution', signal);
    if (!aiResult.success) {
      return { success: false, error: aiResult.error };
    }

    const responseContent = aiResult.content

    if (!responseContent) {
      return {
        success: false,
        error: "No response content received"
      };
    }

    // Extract parts from the response
    const codeMatch = responseContent.match(/```(?:\w+)?\s*([\s\S]*?)```/);
    const code = codeMatch ? codeMatch[1].trim() : responseContent;

    // Extract thoughts, looking for bullet points or numbered lists
    const thoughtsRegex = /(?:Thoughts:|Key Insights:|Reasoning:|Approach:)([\s\S]*?)(?:Time complexity:|$)/i;
    const thoughtsMatch = responseContent.match(thoughtsRegex);
    let thoughts: string[] = [];

    if (thoughtsMatch && thoughtsMatch[1]) {
      // Extract bullet points or numbered items
      const bulletPoints = thoughtsMatch[1].match(/(?:^|\n)\s*(?:[-*•]|\d+\.)\s*(.*)/g);
      if (bulletPoints) {
        thoughts = bulletPoints.map(point =>
          point.replace(/^\s*(?:[-*•]|\d+\.)\s*/, '').trim()
        ).filter(Boolean);
      } else {
        // If no bullet points found, split by newlines and filter empty lines
        thoughts = thoughtsMatch[1].split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
      }
    }

    // Extract complexity information
    const timeComplexityPattern = /Time complexity:?\s*([^\n]+(?:\n[^\n]+)*?)(?=\n\s*(?:Space complexity|$))/i;
    const spaceComplexityPattern = /Space complexity:?\s*([^\n]+(?:\n[^\n]+)*?)(?=\n\s*(?:[A-Z]|$))/i;

    let timeComplexity = "O(n) - Linear time complexity because we only iterate through the array once. Each element is processed exactly one time, and the hashmap lookups are O(1) operations.";
    let spaceComplexity = "O(n) - Linear space complexity because we store elements in the hashmap. In the worst case, we might need to store all elements before finding the solution pair.";

    const timeMatch = responseContent.match(timeComplexityPattern);
    if (timeMatch && timeMatch[1]) {
      timeComplexity = timeMatch[1].trim();
      if (!timeComplexity.match(/O\([^)]+\)/i)) {
        timeComplexity = `O(n) - ${timeComplexity}`;
      } else if (!timeComplexity.includes('-') && !timeComplexity.includes('because')) {
        const notationMatch = timeComplexity.match(/O\([^)]+\)/i);
        if (notationMatch) {
          const notation = notationMatch[0];
          const rest = timeComplexity.replace(notation, '').trim();
          timeComplexity = `${notation} - ${rest}`;
        }
      }
    }

    const spaceMatch = responseContent.match(spaceComplexityPattern);
    if (spaceMatch && spaceMatch[1]) {
      spaceComplexity = spaceMatch[1].trim();
      if (!spaceComplexity.match(/O\([^)]+\)/i)) {
        spaceComplexity = `O(n) - ${spaceComplexity}`;
      } else if (!spaceComplexity.includes('-') && !spaceComplexity.includes('because')) {
        const notationMatch = spaceComplexity.match(/O\([^)]+\)/i);
        if (notationMatch) {
          const notation = notationMatch[0];
          const rest = spaceComplexity.replace(notation, '').trim();
          spaceComplexity = `${notation} - ${rest}`;
        }
      }
    }

    const formattedResponse = {
      code: code,
      thoughts: thoughts.length > 0 ? thoughts : ["Solution approach based on efficiency and readability"],
      time_complexity: timeComplexity,
      space_complexity: spaceComplexity
    };

    return { success: true, data: formattedResponse };
  }

  private async processExtraScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
      const problemInfo = this.deps.getProblemInfo();
      const language = await this.getLanguage();

      if (!problemInfo) {
        return {
          success: false,
          error: "No problem info available"
        };
      }

      // Update progress status
      this.updateProcessingStatus("Processing debug screenshots...", 30)

      // Prepare the images for the API call
      const imageDataList = screenshots.map(screenshot => screenshot.data);

      const debugPrompt = `
You are a coding interview assistant helping debug and improve solutions. Analyze these screenshots which include either error messages, incorrect outputs, or test cases, and provide detailed debugging help.

I'm solving this coding problem: "${problemInfo.problem_statement}" in ${language}. I need help with debugging or improving my solution. Here are screenshots of my code, the errors or test cases. Please provide a detailed analysis with:
1. What issues you found in my code
2. Specific improvements and corrections
3. Any optimizations that would make the solution better
4. A clear explanation of the changes needed

YOUR RESPONSE MUST FOLLOW THIS EXACT STRUCTURE WITH THESE SECTION HEADERS:
### Issues Identified
- List each issue as a bullet point with clear explanation

### Specific Improvements and Corrections
- List specific code changes needed as bullet points

### Optimizations
- List any performance optimizations if applicable

### Explanation of Changes Needed
Here provide a clear explanation of why the changes are needed

### Key Points
- Summary bullet points of the most important takeaways

If you include code examples, use proper markdown code blocks with language specification (e.g. \`\`\`java).
`;

      const aiResult = await this.callAIModel(debugPrompt, imageDataList, 'debugging', signal);
      if (!aiResult.success) {
        return { success: false, error: aiResult.error };
      }
      const debugContent = aiResult.content

      this.updateProcessingStatus("Debug analysis complete", 100)

      if (!debugContent) {
        return {
          success: false,
          error: "No debug content received"
        };
      }

      let extractedCode = "// Debug mode - see analysis below";
      const codeMatch = debugContent.match(/```(?:[a-zA-Z]+)?([\s\S]*?)```/);
      if (codeMatch && codeMatch[1]) {
        extractedCode = codeMatch[1].trim();
      }

      let formattedDebugContent = debugContent;

      if (!debugContent.includes('# ') && !debugContent.includes('## ')) {
        formattedDebugContent = debugContent
          .replace(/issues identified|problems found|bugs found/i, '## Issues Identified')
          .replace(/code improvements|improvements|suggested changes/i, '## Code Improvements')
          .replace(/optimizations|performance improvements/i, '## Optimizations')
          .replace(/explanation|detailed analysis/i, '## Explanation');
      }

      const bulletPoints = formattedDebugContent.match(/(?:^|\n)[ ]*(?:[-*•]|\d+\.)[ ]+([^\n]+)/g);
      const thoughts = bulletPoints
        ? bulletPoints.map(point => point.replace(/^[ ]*(?:[-*•]|\d+\.)[ ]+/, '').trim()).slice(0, 5)
        : ["Debug analysis based on your screenshots"];

      const response = {
        code: extractedCode,
        debug_analysis: formattedDebugContent,
        thoughts: thoughts,
        time_complexity: "N/A - Debug mode",
        space_complexity: "N/A - Debug mode"
      };

      return { success: true, data: response };
  }

  private async callAIModel(
    prompt: string,
    imageDataList: string[] = [],
    modelType: 'extraction' | 'solution' | 'debugging',
    signal?: AbortSignal
  ): Promise<{ success: boolean; content?: string; error?: string }> {
    const config = configHelper.loadConfig();

    const modelMap = {
      extraction: config.extractionModel,
      solution: config.solutionModel,
      debugging: config.debuggingModel
    };
    const modelName = modelMap[modelType] || (
      config.apiProvider === 'openai' ? 'gpt-4o' :
      config.apiProvider === 'gemini' ? 'gemini-2.0-flash' :
      'claude-3-7-sonnet-20250219'
    );

    switch (modelType){
      case 'solution':
        this.updateProcessingStatus("Creating optimal solution with detailed explanations...", 60)
        break
      case 'extraction':
        this.updateProcessingStatus("Analyzing problem from screenshots...", 20)
        break
      case 'debugging':
        this.updateProcessingStatus("Analyzing code and generating debug feedback...", 60)
        break
    }

    try {
      if (config.apiProvider === "openai") {
        if (!this.openaiClient) {
          return { success: false, error: "OpenAI API key not configured. Please check your settings." };
        }
        const messages = [
          {
            role: "system" as const,
            content: modelType === 'solution'
              ? "You are an expert coding interview assistant. Provide clear, optimal solutions with detailed explanations."
              : `You are a coding challenge interpreter. Analyze the screenshot of the coding problem and extract all relevant information.
               Return the information in JSON format with these fields: problem_statement, constraints, example_input, example_output.
               Just return the structured JSON without any other text.`
          },
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: prompt },
              ...imageDataList.map(data => ({
                type: "image_url" as const,
                image_url: { url: `data:image/png;base64,${data}` }
              }))
            ]
          }
        ];

        const response = await this.openaiClient.chat.completions.create({
          model: modelName,
          messages,
          max_tokens: 4000,
          temperature: 0.2
        });

        const content = response.choices[0].message.content;
        return content ? { success: true, content } : { success: false, error: "No response content" };

      } else if (config.apiProvider === "gemini") {
        if (!this.geminiApiKey) {
          return { success: false, error: "Gemini API key not configured. Please check your settings." };
        }
        const geminiMessages: GeminiMessage[] = [
          {
            role: "user",
            parts: [
              {
                text: prompt
              },
              ...imageDataList.map(data => ({
                inlineData: {
                  mimeType: "image/png",
                  data: data
                }
              }))
            ]
          }
        ];

        const response = await axios.default.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${this.geminiApiKey}`,
          {
            contents: geminiMessages,
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 4000
            }
          },
          { signal }
        );

        const geminiRes = response.data as GeminiResponse;
        const content = geminiRes.candidates[0].content.parts[0].text
        return content ? { success: true, content } : { success: false, error: "No response content" };
      } else if (config.apiProvider === "anthropic") {
        if (!this.anthropicClient) {
          return { success: false, error: "Anthropic API key not configured. Please check your settings." };
        }

        const messages: AnthropicMessage[] = [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...imageDataList.map(data => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: "image/png" as const, data }
            }))
          ]
        }];

        const response = await this.anthropicClient.messages.create({
          model: modelName,
          max_tokens: 4000,
          messages,
          temperature: 0.2
        });

        const content = (response.content[0] as { type: 'text', text: string }).text;
        return content ? { success: true, content } : { success: false, error: "No response content" };
      } else {
        return { success: false, error: "Unsupported AI provider" };
      }
    } catch (error: unknown) {
      console.error(`Error in callAIModel (${config.apiProvider}, modelType: ${modelType}):`, error);

      let errorMessage = "Failed to process request. Please try again.";

      if (error instanceof ClaudeAPIError) {
        if (error.status === 429) errorMessage = "Claude API rate limit exceeded. Please wait a few minutes before trying again.";
        else if (error.status === 413) errorMessage = "Your screenshots contain too much information for Claude to process. Switch to OpenAI or Gemini in settings which can handle larger inputs.";

      } else if (error instanceof OpenAiAPIError) {
        if (error.status === 401) {
          errorMessage = 'Invalid OpenAI API key. Please check your settings.';
        } else if (error.status === 429) {
          errorMessage = 'OpenAI API rate limit exceeded or insufficient credits. Please try again later.';
        } else if (error.status === 500) {
          errorMessage = 'OpenAI server error. Please try again later.';
        }

      } else if (axios.isCancel(error)) {
        errorMessage = "Request was canceled by the user.";

      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      return { success: false, error: errorMessage };
    }
  }

  private updateProcessingStatus(message: string, progress: number): void {
    const mainWindow = this.deps.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("processing-status", { message, progress });
    }
  }

  private sendProcessingEvent<K extends keyof typeof this.deps.PROCESSING_EVENTS>(
    eventKey: K,
    payload?: unknown
  ): void {
    const mainWindow = this.deps.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const eventName = this.deps.PROCESSING_EVENTS[eventKey];
    mainWindow.webContents.send(eventName, payload);
  }

  public cancelOngoingRequests(): void {
    let wasCancelled = false

    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort()
      this.currentProcessingAbortController = null
      wasCancelled = true
    }

    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort()
      this.currentExtraProcessingAbortController = null
      wasCancelled = true
    }

    this.deps.setHasDebugged(false)

    this.deps.setProblemInfo(null)

    const mainWindow = this.deps.getMainWindow()
    if (wasCancelled && mainWindow && !mainWindow.isDestroyed()) {
      this.sendProcessingEvent('NO_SCREENSHOTS')
    }
  }
}
