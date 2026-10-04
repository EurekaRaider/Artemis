export interface ISizeCalculationResult {
  width: number;
  height: number;
  type?: string;
}

export declare function imageSize(
  input: Uint8Array | string,
): ISizeCalculationResult;
export declare function disableFS(disable: boolean): void;
export declare function disableTypes(types: string[]): void;
export declare function setConcurrency(concurrency: number): void;
export declare const types: string[];
export default imageSize;
