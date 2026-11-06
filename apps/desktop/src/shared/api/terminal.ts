export interface TerminalApi {
  openTerminal(input: TerminalOpenInput): Promise<TerminalDescriptor>;
  writeTerminal(terminalId: string, data: string): Promise<void>;
  resizeTerminal(terminalId: string, cols: number, rows: number): Promise<void>;
  closeTerminal(terminalId: string): Promise<void>;
  onTerminalData(listener: (event: TerminalData) => void): () => void;
  onTerminalExit(listener: (event: TerminalExit) => void): () => void;
}

export interface TerminalOpenInput {
  threadId: string;
  cols: number;
  rows: number;
}

export interface TerminalDescriptor {
  terminalId: string;
  shell: string;
  sandboxImplementation: string;
}

export interface TerminalData {
  terminalId: string;
  data: string;
}

export interface TerminalExit {
  terminalId: string;
  exitCode: number;
  signal?: number;
}
