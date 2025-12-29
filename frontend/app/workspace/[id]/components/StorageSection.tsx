"use client";

import { useState } from "react";

type FileType = "document" | "meeting" | "image" | "folder";

interface FileItem {
  id: number;
  name: string;
  type: FileType;
  size?: string;
  updatedAt: string;
  updatedBy: string;
  children?: FileItem[];
}

const mockFiles: FileItem[] = [
  {
    id: 1,
    name: "프로젝트 문서",
    type: "folder",
    updatedAt: "2일 전",
    updatedBy: "김철수",
    children: [
      { id: 11, name: "프로젝트 개요.pdf", type: "document", size: "2.4 MB", updatedAt: "3일 전", updatedBy: "김철수" },
      { id: 12, name: "기술 스택 정리.md", type: "document", size: "156 KB", updatedAt: "1주 전", updatedBy: "박민수" },
    ],
  },
  {
    id: 2,
    name: "회의록",
    type: "folder",
    updatedAt: "오늘",
    updatedBy: "이영희",
    children: [
      { id: 21, name: "12월 4주차 스프린트 회의.md", type: "meeting", size: "89 KB", updatedAt: "오늘", updatedBy: "이영희" },
      { id: 22, name: "12월 3주차 스프린트 회의.md", type: "meeting", size: "124 KB", updatedAt: "1주 전", updatedBy: "이영희" },
      { id: 23, name: "킥오프 미팅.md", type: "meeting", size: "256 KB", updatedAt: "2주 전", updatedBy: "김철수" },
    ],
  },
  {
    id: 3,
    name: "디자인 리소스",
    type: "folder",
    updatedAt: "3일 전",
    updatedBy: "정수진",
  },
  { id: 4, name: "API 문서.pdf", type: "document", size: "1.8 MB", updatedAt: "5일 전", updatedBy: "최동훈" },
  { id: 5, name: "브랜드 가이드라인.pdf", type: "document", size: "4.2 MB", updatedAt: "1주 전", updatedBy: "정수진" },
  { id: 6, name: "시스템 아키텍처.png", type: "image", size: "892 KB", updatedAt: "2주 전", updatedBy: "박민수" },
];

const typeIcons: Record<FileType, React.ReactNode> = {
  folder: (
    <svg className="w-6 h-6 text-amber-500" fill="currentColor" viewBox="0 0 24 24">
      <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
    </svg>
  ),
  document: (
    <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ),
  meeting: (
    <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  ),
  image: (
    <svg className="w-6 h-6 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
};

export default function StorageSection() {
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPath, setCurrentPath] = useState<FileItem[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);

  const currentFolder = currentPath.length > 0 ? currentPath[currentPath.length - 1] : null;
  const displayFiles = currentFolder?.children || mockFiles;

  const filteredFiles = displayFiles.filter((file) =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleFileClick = (file: FileItem) => {
    if (file.type === "folder") {
      setCurrentPath([...currentPath, file]);
      setSelectedFile(null);
    } else {
      setSelectedFile(file);
    }
  };

  const handleBreadcrumbClick = (index: number) => {
    if (index === -1) {
      setCurrentPath([]);
    } else {
      setCurrentPath(currentPath.slice(0, index + 1));
    }
    setSelectedFile(null);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-8 py-5 border-b border-black/5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold text-black">저장소</h1>
            <p className="text-sm text-black/40 mt-0.5">문서, 회의록, 리소스 관리</p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-black/80 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            업로드
          </button>
        </div>

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
        {currentPath.length > 0 && (
          <div className="flex items-center gap-1 mt-4 text-sm">
            <button
              onClick={() => handleBreadcrumbClick(-1)}
              className="text-black/50 hover:text-black transition-colors"
            >
              저장소
            </button>
            {currentPath.map((folder, index) => (
              <div key={folder.id} className="flex items-center gap-1">
                <svg className="w-4 h-4 text-black/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <button
                  onClick={() => handleBreadcrumbClick(index)}
                  className={`${
                    index === currentPath.length - 1
                      ? "text-black font-medium"
                      : "text-black/50 hover:text-black"
                  } transition-colors`}
                >
                  {folder.name}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto p-6">
        {viewMode === "list" ? (
          <div className="space-y-1">
            {filteredFiles.map((file) => (
              <button
                key={file.id}
                onClick={() => handleFileClick(file)}
                className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all text-left ${
                  selectedFile?.id === file.id
                    ? "bg-black/5"
                    : "hover:bg-black/[0.02]"
                }`}
              >
                {typeIcons[file.type]}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-black truncate">{file.name}</p>
                  <p className="text-xs text-black/40">
                    {file.size && `${file.size} · `}
                    {file.updatedAt} · {file.updatedBy}
                  </p>
                </div>
                <button className="p-2 rounded-lg hover:bg-black/5 text-black/30 hover:text-black/60 transition-colors opacity-0 group-hover:opacity-100">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                  </svg>
                </button>
              </button>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredFiles.map((file) => (
              <button
                key={file.id}
                onClick={() => handleFileClick(file)}
                className={`p-4 rounded-xl transition-all text-left ${
                  selectedFile?.id === file.id
                    ? "bg-black/5 ring-2 ring-black/10"
                    : "bg-black/[0.02] hover:bg-black/[0.04]"
                }`}
              >
                <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center mb-3 shadow-sm">
                  {typeIcons[file.type]}
                </div>
                <p className="font-medium text-sm text-black truncate">{file.name}</p>
                <p className="text-xs text-black/40 mt-1">{file.updatedAt}</p>
              </button>
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
            <p className="text-sm text-black/40">
              {searchQuery
                ? "다른 검색어로 시도해보세요"
                : "파일을 업로드하여 팀과 공유하세요"}
            </p>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="px-6 py-4 border-t border-black/5 flex items-center gap-3">
        <button className="flex-1 py-3 border-2 border-dashed border-black/10 rounded-xl text-black/40 hover:border-black/20 hover:text-black/60 transition-colors flex items-center justify-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="text-sm font-medium">새 문서</span>
        </button>
        <button className="flex-1 py-3 border-2 border-dashed border-black/10 rounded-xl text-black/40 hover:border-black/20 hover:text-black/60 transition-colors flex items-center justify-center gap-2">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
          </svg>
          <span className="text-sm font-medium">새 폴더</span>
        </button>
      </div>
    </div>
  );
}
