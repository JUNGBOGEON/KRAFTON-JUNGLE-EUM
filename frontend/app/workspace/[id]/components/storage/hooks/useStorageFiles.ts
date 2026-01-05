import { useState, useEffect, useCallback, useMemo } from "react";
import { apiClient } from "../../../../../lib/api";
import { WorkspaceFile, FileStats } from "../types";

interface UseStorageFilesProps {
  workspaceId: number;
}

interface UseStorageFilesReturn {
  files: WorkspaceFile[];
  setFiles: React.Dispatch<React.SetStateAction<WorkspaceFile[]>>;
  breadcrumbs: WorkspaceFile[];
  currentFolderId: number | undefined;
  setCurrentFolderId: (id: number | undefined) => void;
  isLoading: boolean;
  selectedFile: WorkspaceFile | null;
  setSelectedFile: (file: WorkspaceFile | null) => void;
  fileStats: FileStats;
  loadFiles: () => Promise<void>;
  handleFileClick: (file: WorkspaceFile) => Promise<{ isMedia: boolean; url: string | null }>;
  handleBreadcrumbClick: (folderId?: number) => void;
  handleCreateFolder: (name: string) => Promise<void>;
  handleDeleteFile: (file: WorkspaceFile) => Promise<void>;
  handleRenameFile: (fileId: number, newName: string) => Promise<void>;
}

export function useStorageFiles({ workspaceId }: UseStorageFilesProps): UseStorageFilesReturn {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<WorkspaceFile[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<number | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<WorkspaceFile | null>(null);

  const loadFiles = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await apiClient.getWorkspaceFiles(workspaceId, currentFolderId);
      setFiles(response.files);
      setBreadcrumbs(response.breadcrumbs || []);
    } catch (error) {
      console.error("Failed to load files:", error);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, currentFolderId]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const fileStats = useMemo<FileStats>(() => {
    const stats: FileStats = {
      totalFiles: 0,
      totalFolders: 0,
      totalSize: 0,
      imageCount: 0,
      documentCount: 0,
      videoCount: 0,
      otherCount: 0,
    };

    files.forEach((file) => {
      if (file.type === "FOLDER") {
        stats.totalFolders++;
      } else {
        stats.totalFiles++;
        stats.totalSize += file.file_size || 0;

        const mimeType = file.mime_type || "";
        if (mimeType.startsWith("image/")) stats.imageCount++;
        else if (mimeType.includes("pdf") || mimeType.includes("document")) stats.documentCount++;
        else if (mimeType.startsWith("video/")) stats.videoCount++;
        else stats.otherCount++;
      }
    });

    return stats;
  }, [files]);

  const handleFileClick = useCallback(async (file: WorkspaceFile) => {
    if (file.type === "FOLDER") {
      setCurrentFolderId(file.id);
      setSelectedFile(null);
      return { isMedia: false, url: null };
    }

    setSelectedFile(file);
    const isImage = file.mime_type?.startsWith("image/") || false;
    const isVideo = file.mime_type?.startsWith("video/") || false;
    const isMedia = isImage || isVideo;

    try {
      const { url } = await apiClient.getDownloadURL(workspaceId, file.id);
      return { isMedia, url };
    } catch {
      return { isMedia, url: file.file_url || null };
    }
  }, [workspaceId]);

  const handleBreadcrumbClick = useCallback((folderId?: number) => {
    setCurrentFolderId(folderId);
    setSelectedFile(null);
  }, []);

  const handleCreateFolder = useCallback(async (name: string) => {
    const folder = await apiClient.createFolder(workspaceId, name.trim(), currentFolderId);
    setFiles((prev) => [folder, ...prev]);
  }, [workspaceId, currentFolderId]);

  const handleDeleteFile = useCallback(async (file: WorkspaceFile) => {
    await apiClient.deleteFile(workspaceId, file.id);
    setFiles((prev) => prev.filter((f) => f.id !== file.id));
    if (selectedFile?.id === file.id) {
      setSelectedFile(null);
    }
  }, [workspaceId, selectedFile]);

  const handleRenameFile = useCallback(async (fileId: number, newName: string) => {
    const updated = await apiClient.renameFile(workspaceId, fileId, newName.trim());
    setFiles((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
  }, [workspaceId]);

  return {
    files,
    setFiles,
    breadcrumbs,
    currentFolderId,
    setCurrentFolderId,
    isLoading,
    selectedFile,
    setSelectedFile,
    fileStats,
    loadFiles,
    handleFileClick,
    handleBreadcrumbClick,
    handleCreateFolder,
    handleDeleteFile,
    handleRenameFile,
  };
}
