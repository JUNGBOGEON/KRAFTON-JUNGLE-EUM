"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { apiClient, WorkspaceFile } from "../../../lib/api";

interface StorageSectionProps {
  workspaceId: number;
}

// 폴더 업로드용 속성 타입 확장 및 FileSystemEntry 타입 정의
declare module "react" {
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    webkitdirectory?: string;
    directory?: string;
  }
}

// FileSystem API Types (Simplified)
interface FileSystemEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
}

interface FileSystemFileEntry extends FileSystemEntry {
  file: (callback: (file: File) => void) => void;
}

interface FileSystemDirectoryEntry extends FileSystemEntry {
  createReader: () => FileSystemDirectoryReader;
}

interface FileSystemDirectoryReader {
  readEntries: (callback: (entries: FileSystemEntry[]) => void) => void;
}

// 파일 타입별 색상 설정 - 미니멀하게
const FILE_TYPE_CONFIG = {
  folder: { bgColor: "bg-gray-100", textColor: "text-gray-500" },
  image: { bgColor: "bg-gray-100", textColor: "text-gray-500" },
  document: { bgColor: "bg-gray-100", textColor: "text-gray-500" },
  video: { bgColor: "bg-gray-100", textColor: "text-gray-500" },
  audio: { bgColor: "bg-gray-100", textColor: "text-gray-500" },
  code: { bgColor: "bg-gray-100", textColor: "text-gray-500" },
  default: { bgColor: "bg-gray-100", textColor: "text-gray-500" },
};

const getFileTypeConfig = (file: WorkspaceFile) => {
  if (file.type === "FOLDER") return FILE_TYPE_CONFIG.folder;
  const mimeType = file.mime_type || "";
  if (mimeType.startsWith("image/")) return FILE_TYPE_CONFIG.image;
  if (mimeType.startsWith("video/")) return FILE_TYPE_CONFIG.video;
  if (mimeType.startsWith("audio/")) return FILE_TYPE_CONFIG.audio;
  if (mimeType.includes("pdf") || mimeType.includes("document") || mimeType.includes("word")) return FILE_TYPE_CONFIG.document;
  if (mimeType.includes("javascript") || mimeType.includes("json") || mimeType.includes("html") || mimeType.includes("css")) return FILE_TYPE_CONFIG.code;
  return FILE_TYPE_CONFIG.default;
};

const getFileIcon = (file: WorkspaceFile, size: "sm" | "md" | "lg" = "md") => {
  const sizeClasses = { sm: "w-4 h-4", md: "w-5 h-5", lg: "w-6 h-6" };
  const iconSize = sizeClasses[size];

  if (file.type === "FOLDER") {
    return (
      <svg className={`${iconSize} text-amber-500`} fill="currentColor" viewBox="0 0 24 24">
        <path d="M3 7a2 2 0 012-2h4.586a1 1 0 01.707.293L12 7h7a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
      </svg>
    );
  }

  const mimeType = file.mime_type || "";
  if (mimeType.startsWith("image/")) {
    return (
      <svg className={`${iconSize} text-pink-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }
  if (mimeType.includes("pdf")) {
    return (
      <svg className={`${iconSize} text-red-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-6 4h4" />
      </svg>
    );
  }
  if (mimeType.includes("document") || mimeType.includes("word")) {
    return (
      <svg className={`${iconSize} text-blue-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  }
  if (mimeType.startsWith("video/")) {
    return (
      <svg className={`${iconSize} text-emerald-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    );
  }
  if (mimeType.startsWith("audio/")) {
    return (
      <svg className={`${iconSize} text-violet-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
      </svg>
    );
  }

  return (
    <svg className={`${iconSize} text-gray-400`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
};

const formatFileSize = (bytes?: number) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "방금 전";
  if (diffMins < 60) return `${diffMins}분 전`;
  if (diffHours < 24) return `${diffHours}시간 전`;
  if (diffDays === 1) return "어제";
  if (diffDays < 7) return `${diffDays}일 전`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}주 전`;
  return date.toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
};

// 파일 확장자 추출
const getFileExtension = (filename: string) => {
  const parts = filename.split(".");
  return parts.length > 1 ? parts.pop()?.toUpperCase() : "";
};

// 스켈레톤 로딩 컴포넌트
const SkeletonLoader = () => (
  <div className="animate-pulse space-y-3">
    {[1, 2, 3, 4, 5].map((i) => (
      <div key={i} className="flex items-center gap-4 p-4">
        <div className="w-10 h-10 bg-gray-100 rounded-xl" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-gray-100 rounded-lg w-1/3" />
          <div className="h-3 bg-gray-50 rounded-lg w-1/4" />
        </div>
      </div>
    ))}
  </div>
);

export default function StorageSection({ workspaceId }: StorageSectionProps) {
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<WorkspaceFile[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<number | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<WorkspaceFile | null>(null);
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameTarget, setRenameTarget] = useState<WorkspaceFile | null>(null);
  const [newName, setNewName] = useState("");

  // 이미지 미리보기 모달 상태
  const [previewImage, setPreviewImage] = useState<WorkspaceFile | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // New Dropdown State
  const [showNewDropdown, setShowNewDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Drag & Drop State
  const [isDragging, setIsDragging] = useState(false);

  // 파일 업로드 상태
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowNewDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredFiles = files.filter((file) =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // 파일 통계 계산
  const fileStats = useMemo(() => {
    const stats = {
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

  const handleFileClick = async (file: WorkspaceFile) => {
    if (file.type === "FOLDER") {
      setCurrentFolderId(file.id);
      setSelectedFile(null);
    } else {
      setSelectedFile(file);
      const isImage = file.mime_type?.startsWith("image/");

      if (isImage) {
        // 이미지 파일인 경우 미리보기 모달 표시
        setPreviewImage(file);
        try {
          const { url } = await apiClient.getDownloadURL(workspaceId, file.id);
          setPreviewImageUrl(url);
        } catch (error) {
          setPreviewImageUrl(file.file_url || null);
        }
      } else {
        // 이미지가 아닌 경우 새 탭에서 열기
        try {
          const { url } = await apiClient.getDownloadURL(workspaceId, file.id);
          window.open(url, "_blank");
        } catch (error) {
          if (file.file_url) {
            window.open(file.file_url, "_blank");
          }
        }
      }
    }
  };

  const handleBreadcrumbClick = (folderId?: number) => {
    setCurrentFolderId(folderId);
    setSelectedFile(null);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || isCreating) return;

    try {
      setIsCreating(true);
      const folder = await apiClient.createFolder(workspaceId, newFolderName.trim(), currentFolderId);
      setFiles((prev) => [folder, ...prev]);
      setNewFolderName("");
      setShowCreateFolderModal(false);
    } catch (error) {
      console.error("Failed to create folder:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteFile = async (file: WorkspaceFile) => {
    if (!confirm(`"${file.name}"을(를) 삭제하시겠습니까?`)) return;

    try {
      await apiClient.deleteFile(workspaceId, file.id);
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      if (selectedFile?.id === file.id) {
        setSelectedFile(null);
      }
    } catch (error) {
      console.error("Failed to delete file:", error);
    }
  };

  const openRenameModal = (file: WorkspaceFile) => {
    setRenameTarget(file);
    setNewName(file.name);
    setShowRenameModal(true);
  };

  const handleRename = async () => {
    if (!renameTarget || !newName.trim() || isCreating) return;

    try {
      setIsCreating(true);
      const updated = await apiClient.renameFile(workspaceId, renameTarget.id, newName.trim());
      setFiles((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      setShowRenameModal(false);
      setRenameTarget(null);
      setNewName("");
    } catch (error) {
      console.error("Failed to rename file:", error);
    } finally {
      setIsCreating(false);
    }
  };

  // --- 업로드 로직 통합 ---

  const uploadSingleFile = async (file: File, parentId?: number) => {
    // 1. Presigned URL 얻기
    const presigned = await apiClient.getPresignedURL(
      workspaceId,
      file.name,
      file.type || "application/octet-stream",
      parentId
    );

    // 2. S3에 직접 업로드
    await apiClient.uploadFileToS3(presigned.upload_url, file);

    // 3. 업로드 확인 및 DB 저장
    const uploadedFile = await apiClient.confirmUpload(workspaceId, {
      name: file.name,
      key: presigned.key,
      file_size: file.size,
      mime_type: file.type || "application/octet-stream",
      parent_folder_id: parentId,
    });

    return uploadedFile;
  };

  // 파일 + 경로(폴더 구조) 처리 및 업로드 실행
  const processAndUploadFiles = async (fileList: Array<{ file: File, path: string }>) => {
    if (fileList.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);
    setUploadStatus("폴더 구조 분석 중...");
    setUploadError(null);
    setShowNewDropdown(false);

    try {
      const totalFiles = fileList.length;
      let uploadedCount = 0;

      // 폴더 경로 캐시 (경로 문자열 -> 폴더 ID)
      const folderPathMap = new Map<string, number>();

      for (const { file, path } of fileList) {
        // path: "Folder/SubFolder/file.txt" or "file.txt"
        // mac/linux separator "/"
        const pathParts = path.split('/').filter(p => p !== "."); // "." 은 현재 경로

        // 마지막 요소(파일명) 제외한 경로 처리
        let parentId = currentFolderId;
        let currentPath = "";

        // 폴더 구조 생성
        for (let i = 0; i < pathParts.length - 1; i++) {
          const folderName = pathParts[i];
          if (!folderName) continue;

          currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;

          if (folderPathMap.has(currentPath)) {
            parentId = folderPathMap.get(currentPath);
          } else {
            setUploadStatus(`폴더 생성 중: ${folderName}`);
            // 폴더 생성 - 실제로는 생성 전 DB 체크가 좋지만 API 제약상 create 호출 (이름 중복 시 허용됨)
            const newFolder = await apiClient.createFolder(workspaceId, folderName, parentId);
            parentId = newFolder.id;
            folderPathMap.set(currentPath, parentId);

            // 현재 폴더에 생성된 경우 목록 즉시 반영
            if (newFolder.parent_folder_id === currentFolderId) {
              setFiles(prev => [newFolder, ...prev]);
            }
          }
        }

        // 파일 업로드
        setUploadStatus(`업로드 중: ${file.name}`);
        const uploadedFile = await uploadSingleFile(file, parentId);

        if (uploadedFile.parent_folder_id === currentFolderId) {
          setFiles((prev) => [uploadedFile, ...prev]);
        }

        uploadedCount++;
        setUploadProgress(Math.round((uploadedCount / totalFiles) * 100));
      }

      loadFiles();

    } catch (error) {
      console.error("Failed to upload:", error);
      setUploadError("업로드 중 오류가 발생했습니다.");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setUploadStatus("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (!selectedFiles) return;
    const fileList = Array.from(selectedFiles).map(file => ({ file, path: file.name }));
    processAndUploadFiles(fileList);
  };

  const handleFolderUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (!selectedFiles) return;
    const fileList = Array.from(selectedFiles).map(file => ({ file, path: file.webkitRelativePath || file.name }));
    processAndUploadFiles(fileList);
  };

  // --- Drag & Drop Logic ---

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 드래그가 자식 요소로 들어갔을 때 leave가 트리거되는 것 방지
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const items = e.dataTransfer.items;
    if (!items) return;

    const fileList: Array<{ file: File, path: string }> = [];

    // 스캔 큐 (비동기 처리)
    const scanEntry = (entry: FileSystemEntry) => {
      return new Promise<void>((resolve) => {
        if (entry.isFile) {
          (entry as FileSystemFileEntry).file((file) => {
            // fullPath는 "/folder/file.txt" 형태. 맨 앞 slash 제거
            const path = entry.fullPath.startsWith('/') ? entry.fullPath.slice(1) : entry.fullPath;
            fileList.push({ file, path });
            resolve();
          });
        } else if (entry.isDirectory) {
          const dirReader = (entry as FileSystemDirectoryEntry).createReader();
          dirReader.readEntries(async (entries) => {
            for (const childEntry of entries) {
              await scanEntry(childEntry); // 재귀 호출
            }
            resolve();
          });
        } else {
          resolve();
        }
      });
    };

    setUploadStatus("파일 목록 스캔 중...");

    // 모든 아이템 스캔
    const promises = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry?.();
        if (entry) {
          promises.push(scanEntry(entry));
        } else {
          // fallback for non-webkit
          const file = item.getAsFile();
          if (file) {
            fileList.push({ file, path: file.name });
          }
        }
      }
    }

    await Promise.all(promises);
    processAndUploadFiles(fileList);
  };

  return (
    <div
      className="h-full flex flex-col relative bg-white"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag Overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-gray-900/5 border-2 border-dashed border-gray-300 z-50 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <svg className="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <p className="text-sm text-gray-500">파일을 놓으세요</p>
          </div>
        </div>
      )}

      {/* Hidden inputs */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        className="hidden"
        multiple
      />
      <input
        type="file"
        ref={folderInputRef}
        onChange={handleFolderUpload}
        className="hidden"
        webkitdirectory="true"
        directory="true"
      />

      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">저장소</h1>
            {files.length > 0 && (
              <p className="text-xs text-gray-400 mt-0.5">
                {fileStats.totalFolders > 0 && `${fileStats.totalFolders}개 폴더`}
                {fileStats.totalFolders > 0 && fileStats.totalFiles > 0 && " · "}
                {fileStats.totalFiles > 0 && `${fileStats.totalFiles}개 파일`}
              </p>
            )}
          </div>

          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowNewDropdown(!showNewDropdown)}
              disabled={isUploading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              {isUploading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>{uploadProgress}%</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  새로 만들기
                </>
              )}
            </button>

            {showNewDropdown && !isUploading && (
              <div className="absolute top-full right-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-100 py-1 z-50">
                <button
                  onClick={() => {
                    setShowCreateFolderModal(true);
                    setShowNewDropdown(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  새 폴더
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  파일 업로드
                </button>
                <button
                  onClick={() => folderInputRef.current?.click()}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  폴더 업로드
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Upload Progress */}
        {isUploading && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span>{uploadStatus}</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-gray-900 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
            </div>
          </div>
        )}

        {/* Upload Error */}
        {uploadError && (
          <div className="mb-3 px-3 py-2 bg-red-50 rounded-lg text-sm text-red-600 flex items-center justify-between">
            <span>{uploadError}</span>
            <button onClick={() => setUploadError(null)} className="text-red-400 hover:text-red-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Search & View Toggle */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-100 rounded-lg text-sm placeholder:text-gray-400 focus:outline-none focus:border-gray-200"
            />
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <div className="flex items-center border border-gray-100 rounded-lg">
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 ${viewMode === "list" ? "text-gray-900 bg-gray-50" : "text-gray-400"}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1.5 ${viewMode === "grid" ? "text-gray-900 bg-gray-50" : "text-gray-400"}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Breadcrumb */}
        {currentFolderId && (
          <div className="flex items-center gap-1 mt-3 text-sm">
            <button
              onClick={() => handleBreadcrumbClick(undefined)}
              className="text-gray-400 hover:text-gray-600"
            >
              저장소
            </button>
          {breadcrumbs.map((folder, index) => (
            <div key={folder.id} className="flex items-center gap-1">
              <span className="text-gray-300">/</span>
              <button
                onClick={() => handleBreadcrumbClick(folder.id)}
                className={index === breadcrumbs.length - 1 ? "text-gray-900" : "text-gray-400 hover:text-gray-600"}
              >
                {folder.name}
              </button>
            </div>
          ))}
          </div>
        )}
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <SkeletonLoader />
        ) : viewMode === "list" ? (
          <div className="space-y-0.5">
            {filteredFiles.map((file) => {
              const isImage = file.mime_type?.startsWith("image/");
              return (
                <div
                  key={file.id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer group ${
                    selectedFile?.id === file.id ? "bg-gray-100" : "hover:bg-gray-50"
                  }`}
                  onClick={() => handleFileClick(file)}
                >
                  {/* Icon */}
                  <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {isImage && file.file_url ? (
                      <img src={file.file_url} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    ) : (
                      getFileIcon(file, "md")
                    )}
                  </div>

                  {/* File Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 truncate">{file.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {file.file_size ? formatFileSize(file.file_size) : ""}
                      {file.file_size && " · "}
                      {formatDate(file.created_at)}
                    </p>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                    <button
                      onClick={(e) => { e.stopPropagation(); openRenameModal(file); }}
                      className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteFile(file); }}
                      className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filteredFiles.map((file) => {
              const isImage = file.mime_type?.startsWith("image/");
              return (
                <div
                  key={file.id}
                  className={`group relative rounded-lg border cursor-pointer ${
                    selectedFile?.id === file.id ? "border-gray-300 bg-gray-50" : "border-gray-100 hover:border-gray-200 hover:bg-gray-50"
                  }`}
                  onClick={() => handleFileClick(file)}
                >
                  {/* Thumbnail */}
                  <div className="aspect-square bg-gray-50 rounded-t-lg flex items-center justify-center overflow-hidden">
                    {isImage && file.file_url ? (
                      <img src={file.file_url} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    ) : (
                      getFileIcon(file, "lg")
                    )}
                  </div>
                  {/* Info */}
                  <div className="p-2.5">
                    <p className="text-sm text-gray-900 truncate">{file.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{formatDate(file.created_at)}</p>
                  </div>
                  {/* Hover Actions */}
                  <div className="absolute top-2 right-2 hidden group-hover:flex gap-0.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); openRenameModal(file); }}
                      className="p-1 rounded bg-white text-gray-500 hover:text-gray-700 shadow-sm"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteFile(file); }}
                      className="p-1 rounded bg-white text-gray-500 hover:text-red-500 shadow-sm"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Empty State */}
        {!isLoading && filteredFiles.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-xl bg-gray-100 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              {searchQuery ? `"${searchQuery}" 검색 결과 없음` : "파일이 없습니다"}
            </p>
            {!searchQuery && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-sm text-gray-900 hover:underline"
              >
                파일 업로드
              </button>
            )}
          </div>
        )}
      </div>

      {/* Create Folder Modal */}
      {showCreateFolderModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-full max-w-sm mx-4 shadow-xl">
            <div className="p-4 border-b border-gray-100">
              <h2 className="text-base font-medium text-gray-900">새 폴더</h2>
            </div>
            <div className="p-4">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="폴더 이름"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-300"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
              />
            </div>
            <div className="px-4 pb-4 flex gap-2 justify-end">
              <button
                onClick={() => { setShowCreateFolderModal(false); setNewFolderName(""); }}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
              >
                취소
              </button>
              <button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim() || isCreating}
                className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
              >
                {isCreating ? "생성 중..." : "만들기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {showRenameModal && renameTarget && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-full max-w-sm mx-4 shadow-xl">
            <div className="p-4 border-b border-gray-100">
              <h2 className="text-base font-medium text-gray-900">이름 변경</h2>
            </div>
            <div className="p-4">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="새 이름"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-300"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleRename()}
              />
            </div>
            <div className="px-4 pb-4 flex gap-2 justify-end">
              <button
                onClick={() => { setShowRenameModal(false); setRenameTarget(null); setNewName(""); }}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
              >
                취소
              </button>
              <button
                onClick={handleRename}
                disabled={!newName.trim() || isCreating}
                className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
              >
                {isCreating ? "변경 중..." : "변경"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {previewImage && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
          onClick={() => { setPreviewImage(null); setPreviewImageUrl(null); }}
        >
          {/* Close Button */}
          <button
            onClick={() => { setPreviewImage(null); setPreviewImageUrl(null); }}
            className="absolute top-4 right-4 p-2 text-white/70 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* File Name */}
          <div className="absolute top-4 left-4 text-white/90 text-sm font-medium max-w-[60%] truncate">
            {previewImage.name}
          </div>

          {/* Image Container */}
          <div
            className="max-w-[90vw] max-h-[85vh] flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {previewImageUrl ? (
              <img
                src={previewImageUrl}
                alt={previewImage.name}
                className="max-w-full max-h-[85vh] object-contain rounded-lg"
              />
            ) : (
              <div className="flex items-center justify-center w-32 h-32 bg-white/10 rounded-lg">
                <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              </div>
            )}
          </div>

          {/* Bottom Info */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-4 text-sm text-white/70">
            {previewImage.file_size && (
              <span>{formatFileSize(previewImage.file_size)}</span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (previewImageUrl) {
                  window.open(previewImageUrl, "_blank");
                }
              }}
              className="flex items-center gap-1 hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              새 탭에서 열기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
