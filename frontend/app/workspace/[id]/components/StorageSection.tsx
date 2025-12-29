"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { apiClient, WorkspaceFile } from "../../../lib/api";

interface StorageSectionProps {
  workspaceId: number;
}

const getFileIcon = (file: WorkspaceFile) => {
  if (file.type === "FOLDER") {
    return (
      <svg className="w-6 h-6 text-amber-500" fill="currentColor" viewBox="0 0 24 24">
        <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
      </svg>
    );
  }

  const mimeType = file.mime_type || "";
  if (mimeType.startsWith("image/")) {
    return (
      <svg className="w-6 h-6 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }
  if (mimeType.includes("pdf") || mimeType.includes("document")) {
    return (
      <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    );
  }
  if (mimeType.includes("video")) {
    return (
      <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    );
  }

  return (
    <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "오늘";
  if (diffDays === 1) return "어제";
  if (diffDays < 7) return `${diffDays}일 전`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}주 전`;
  return date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
};

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

  // 파일 업로드 상태
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await apiClient.getWorkspaceFiles(workspaceId, currentFolderId);
      setFiles(response.files);
      if (response.breadcrumbs) {
        setBreadcrumbs(response.breadcrumbs);
      }
    } catch (error) {
      console.error("Failed to load files:", error);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, currentFolderId]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const filteredFiles = files.filter((file) =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleFileClick = async (file: WorkspaceFile) => {
    if (file.type === "FOLDER") {
      setCurrentFolderId(file.id);
      setSelectedFile(null);
    } else {
      setSelectedFile(file);
      // 파일 다운로드
      try {
        const { url } = await apiClient.getDownloadURL(workspaceId, file.id);
        window.open(url, "_blank");
      } catch (error) {
        // S3가 설정되지 않은 경우 기존 URL 사용
        if (file.file_url) {
          window.open(file.file_url, "_blank");
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

  // 파일 업로드 핸들러
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);
    setUploadError(null);

    try {
      const totalFiles = selectedFiles.length;
      let uploadedCount = 0;

      for (const file of Array.from(selectedFiles)) {
        // 1. Presigned URL 얻기
        const presigned = await apiClient.getPresignedURL(
          workspaceId,
          file.name,
          file.type || "application/octet-stream",
          currentFolderId
        );

        // 2. S3에 직접 업로드
        await apiClient.uploadFileToS3(presigned.upload_url, file);

        // 3. 업로드 확인 및 DB 저장
        const uploadedFile = await apiClient.confirmUpload(workspaceId, {
          name: file.name,
          key: presigned.key,
          file_size: file.size,
          mime_type: file.type || "application/octet-stream",
          parent_folder_id: currentFolderId,
        });

        // 파일 목록에 추가
        setFiles((prev) => [uploadedFile, ...prev]);

        uploadedCount++;
        setUploadProgress(Math.round((uploadedCount / totalFiles) * 100));
      }
    } catch (error) {
      console.error("Failed to upload file:", error);
      setUploadError("파일 업로드에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      // 입력 초기화
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-black/20 border-t-black/60 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        className="hidden"
        multiple
      />

      {/* Header */}
      <div className="px-8 py-5 border-b border-black/5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold text-black">저장소</h1>
            <p className="text-sm text-black/40 mt-0.5">문서, 회의록, 리소스 관리</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreateFolderModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-black/5 text-black text-sm font-medium rounded-lg hover:bg-black/10 transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
              </svg>
              새 폴더
            </button>
            <button
              onClick={triggerFileInput}
              disabled={isUploading}
              className="flex items-center gap-2 px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-black/80 transition-colors disabled:opacity-50"
            >
              {isUploading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  업로드 중... {uploadProgress}%
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  파일 업로드
                </>
              )}
            </button>
          </div>
        </div>

        {/* Upload Error */}
        {uploadError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            {uploadError}
            <button
              onClick={() => setUploadError(null)}
              className="ml-2 text-red-400 hover:text-red-600"
            >
              ✕
            </button>
          </div>
        )}

        {/* Search & View Toggle */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <input
              type="text"
              placeholder="파일 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-black/[0.03] border-0 rounded-lg text-sm placeholder:text-black/30 focus:outline-none focus:ring-2 focus:ring-black/10"
            />
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-black/30"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <div className="flex items-center bg-black/[0.03] rounded-lg p-1">
            <button
              onClick={() => setViewMode("list")}
              className={`p-2 rounded-md transition-all ${
                viewMode === "list"
                  ? "bg-white text-black shadow-sm"
                  : "text-black/50 hover:text-black/70"
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={`p-2 rounded-md transition-all ${
                viewMode === "grid"
                  ? "bg-white text-black shadow-sm"
                  : "text-black/50 hover:text-black/70"
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 mt-4 text-sm">
          <button
            onClick={() => handleBreadcrumbClick(undefined)}
            className={`transition-colors ${
              !currentFolderId ? "text-black font-medium" : "text-black/50 hover:text-black"
            }`}
          >
            저장소
          </button>
          {breadcrumbs.map((folder, index) => (
            <div key={folder.id} className="flex items-center gap-1">
              <svg className="w-4 h-4 text-black/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <button
                onClick={() => handleBreadcrumbClick(folder.id)}
                className={`${
                  index === breadcrumbs.length - 1
                    ? "text-black font-medium"
                    : "text-black/50 hover:text-black"
                } transition-colors`}
              >
                {folder.name}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto p-6">
        {viewMode === "list" ? (
          <div className="space-y-1">
            {filteredFiles.map((file) => (
              <div
                key={file.id}
                className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all text-left group ${
                  selectedFile?.id === file.id
                    ? "bg-black/5"
                    : "hover:bg-black/[0.02]"
                }`}
              >
                <button
                  onClick={() => handleFileClick(file)}
                  className="flex items-center gap-4 flex-1 min-w-0"
                >
                  {getFileIcon(file)}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-black truncate">{file.name}</p>
                    <p className="text-xs text-black/40">
                      {file.file_size ? `${formatFileSize(file.file_size)} · ` : ""}
                      {formatDate(file.created_at)}
                      {file.uploader?.nickname && ` · ${file.uploader.nickname}`}
                    </p>
                  </div>
                </button>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openRenameModal(file)}
                    className="p-2 rounded-lg hover:bg-black/5 text-black/30 hover:text-black/60 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDeleteFile(file)}
                    className="p-2 rounded-lg hover:bg-red-50 text-black/30 hover:text-red-500 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredFiles.map((file) => (
              <div
                key={file.id}
                className={`p-4 rounded-xl transition-all text-left group relative ${
                  selectedFile?.id === file.id
                    ? "bg-black/5 ring-2 ring-black/10"
                    : "bg-black/[0.02] hover:bg-black/[0.04]"
                }`}
              >
                <button
                  onClick={() => handleFileClick(file)}
                  className="w-full text-left"
                >
                  <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center mb-3 shadow-sm">
                    {getFileIcon(file)}
                  </div>
                  <p className="font-medium text-sm text-black truncate">{file.name}</p>
                  <p className="text-xs text-black/40 mt-1">{formatDate(file.created_at)}</p>
                </button>
                <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openRenameModal(file)}
                    className="p-1.5 rounded-lg bg-white/80 hover:bg-white text-black/40 hover:text-black/60 transition-colors shadow-sm"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDeleteFile(file)}
                    className="p-1.5 rounded-lg bg-white/80 hover:bg-red-50 text-black/40 hover:text-red-500 transition-colors shadow-sm"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {filteredFiles.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 rounded-full bg-black/5 flex items-center justify-center mb-4">
              <svg className="w-10 h-10 text-black/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-black/60 mb-1">
              {searchQuery ? "검색 결과 없음" : "파일이 없습니다"}
            </h3>
            <p className="text-sm text-black/40 mb-4">
              {searchQuery
                ? "다른 검색어로 시도해보세요"
                : "파일을 업로드하여 팀과 공유하세요"}
            </p>
            {!searchQuery && (
              <button
                onClick={triggerFileInput}
                className="px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-black/80 transition-colors"
              >
                파일 업로드
              </button>
            )}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="px-6 py-4 border-t border-black/5 flex items-center gap-3">
        <button
          onClick={triggerFileInput}
          disabled={isUploading}
          className="flex-1 py-3 border-2 border-dashed border-black/10 rounded-xl text-black/40 hover:border-black/20 hover:text-black/60 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          <span className="text-sm font-medium">파일 업로드</span>
        </button>
        <button
          onClick={() => setShowCreateFolderModal(true)}
          className="flex-1 py-3 border-2 border-dashed border-black/10 rounded-xl text-black/40 hover:border-black/20 hover:text-black/60 transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
          </svg>
          <span className="text-sm font-medium">새 폴더</span>
        </button>
      </div>

      {/* Create Folder Modal */}
      {showCreateFolderModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold text-black mb-4">새 폴더 만들기</h2>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="폴더 이름"
              className="w-full px-4 py-3 border border-black/10 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-black/10"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowCreateFolderModal(false);
                  setNewFolderName("");
                }}
                className="flex-1 py-3 text-black/60 hover:text-black transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim() || isCreating}
                className="flex-1 py-3 bg-black text-white rounded-lg hover:bg-black/80 transition-colors disabled:opacity-50"
              >
                {isCreating ? "생성 중..." : "만들기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {showRenameModal && renameTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold text-black mb-4">이름 변경</h2>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="새 이름"
              className="w-full px-4 py-3 border border-black/10 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-black/10"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowRenameModal(false);
                  setRenameTarget(null);
                  setNewName("");
                }}
                className="flex-1 py-3 text-black/60 hover:text-black transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleRename}
                disabled={!newName.trim() || isCreating}
                className="flex-1 py-3 bg-black text-white rounded-lg hover:bg-black/80 transition-colors disabled:opacity-50"
              >
                {isCreating ? "변경 중..." : "변경"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
