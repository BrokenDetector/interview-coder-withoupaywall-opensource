export interface ISolutionPayload {
	code: string;
	thoughts: string[];
	time_complexity: string;
	space_complexity: string;
}

export interface IDebugPayload {
	code: string;
	debug_analysis: string;
	thoughts: string[];
	time_complexity: string;
	space_complexity: string;
}

export interface IProblemStatementData {
	problem_statement: string
	constraints: string
	example_input: string
	example_output: string
}

export type { UpdateDownloadedEvent, UpdateInfo } from "electron-updater";
