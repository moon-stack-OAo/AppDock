export interface Storage {
  put(key: string, srcPath: string): Promise<void>;
  openReadStream(key: string): Promise<NodeJS.ReadableStream>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** 确保应用存储前缀目录存在（M1 创建应用时调用） */
  ensurePrefix(prefix: string): Promise<void>;
}

export const STORAGE = Symbol("STORAGE");
