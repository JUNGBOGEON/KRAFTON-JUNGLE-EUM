"use client";

import { useState, useEffect } from "react";
import { CreateFolderModalProps, RenameModalProps, MediaPreviewModalProps, DeleteModalProps } from "../types";
import { formatFileSize, isVideoFile } from "../utils";

// PPT/PDF 등 문서 파일인지 확인
const isDocFile = (file: { name: string }) => {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return ['ppt', 'pptx', 'pdf', 'doc', 'docx', 'xls', 'xlsx'].includes(ext);
};

// 새 폴더 생성 모달
export function CreateFolderModal({ isOpen, onClose, onCreate, isCreating }: CreateFolderModalProps) {
  const [folderName, setFolderName] = useState("");

  useEffect(() => {
    if (!isOpen) setFolderName("");
  }, [isOpen]);

  const handleCreate = async () => {
    if (!folderName.trim() || isCreating) return;
    await onCreate(folderName.trim());
    setFolderName("");
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-sm mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">새 폴더</h2>
          <input
            type="text"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="폴더 이름을 입력하세요"
            className="w-full px-4 py-3 bg-gray-50 border-0 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
        </div>
        <div className="px-5 pb-5 flex gap-2">
          <button
            onClick={() => { onClose(); setFolderName(""); }}
            className="flex-1 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleCreate}
            disabled={!folderName.trim() || isCreating}
            className="flex-1 py-2.5 text-sm font-medium text-white bg-gray-900 rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-40"
          >
            {isCreating ? "생성 중..." : "만들기"}
          </button>
        </div>
      </div>
    </div>
  );
}

// 이름 변경 모달 - 모던하고 미니멀한 디자인
export function RenameModal({ isOpen, file, onClose, onRename, isRenaming }: RenameModalProps) {
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (file) setNewName(file.name);
    else setNewName("");
  }, [file]);

  const handleRename = async () => {
    if (!newName.trim() || isRenaming) return;
    await onRename(newName.trim());
  };

  if (!isOpen || !file) return null;

  const isFolder = file.type === "FOLDER";

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-xs mx-4 shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-4 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center">
            {isFolder ? (
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            )}
          </div>
          <h2 className="text-base font-semibold text-gray-900">이름 변경</h2>
        </div>

        {/* Input */}
        <div className="px-5 pb-4">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="새 이름"
            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-center text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
          />
        </div>

        {/* Actions */}
        <div className="flex border-t border-gray-100">
          <button
            onClick={onClose}
            className="flex-1 py-3.5 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors rounded-bl-2xl"
          >
            취소
          </button>
          <div className="w-px bg-gray-100" />
          <button
            onClick={handleRename}
            disabled={!newName.trim() || newName === file.name || isRenaming}
            className="flex-1 py-3.5 text-sm font-semibold text-gray-900 hover:bg-gray-50 transition-colors rounded-br-2xl disabled:text-gray-300 disabled:cursor-not-allowed"
          >
            {isRenaming ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

// 삭제 확인 모달 - 미니멀하고 명확한 디자인
export function DeleteModal({ isOpen, file, onClose, onDelete, isDeleting }: DeleteModalProps) {
  if (!isOpen || !file) return null;

  const isFolder = file.type === "FOLDER";

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-xs mx-4 shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-4 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-red-50 flex items-center justify-center">
            <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-gray-900 mb-1">
            {isFolder ? "폴더 삭제" : "파일 삭제"}
          </h2>
          <p className="text-sm text-gray-500 break-all px-2">
            "{file.name}"
          </p>
        </div>

        {/* Warning */}
        {isFolder && (
          <div className="px-5 pb-4">
            <p className="text-xs text-center text-gray-400">
              폴더 내 모든 파일도 함께 삭제됩니다
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex border-t border-gray-100">
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="flex-1 py-3.5 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors rounded-bl-2xl disabled:opacity-50"
          >
            취소
          </button>
          <div className="w-px bg-gray-100" />
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="flex-1 py-3.5 text-sm font-semibold text-red-500 hover:bg-red-50 transition-colors rounded-br-2xl disabled:opacity-50"
          >
            {isDeleting ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}

// 파일 미리보기 모달 (이미지 + 동영상 + 문서)
export function FilePreviewModal({ file, mediaUrl, onClose }: MediaPreviewModalProps) {
  if (!file) return null;

  const isVideo = isVideoFile(file);
  // PDF는 네이티브 뷰어 사용, 그 외 문서는 구글 뷰어 사용
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const isPdf = ext === 'pdf';
  const isOfficeDoc = ['ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx'].includes(ext);

  // 로컬/비공개 환경 체크 (Google Viewer가 접근 불가)
  const isLocalhost = mediaUrl?.includes('localhost') || mediaUrl?.includes('127.0.0.1') || mediaUrl?.startsWith('/');

  return (
    <div
      className="fixed inset-0 bg-black/90 flex items-center justify-center z-50"
      onClick={onClose}
    >
      {/* Close Button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 text-white/60 hover:text-white transition-colors z-10"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* File Info */}
      <div className="absolute top-4 left-4 flex items-center gap-3 max-w-[60%] z-10">
        {file.uploader && (
          <div className="flex items-center gap-2">
            {file.uploader.profile_img ? (
              <img
                src={file.uploader.profile_img}
                alt=""
                className="w-8 h-8 rounded-full object-cover border border-white/20"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <span className="text-xs font-medium text-white">
                  {file.uploader.nickname?.charAt(0)}
                </span>
              </div>
            )}
            <div className="flex flex-col">
              <span className="text-white/90 text-sm font-medium truncate">{file.name}</span>
              <span className="text-white/50 text-xs">{file.uploader.nickname}</span>
            </div>
          </div>
        )}
        {!file.uploader && (
          <span className="text-white/80 text-sm font-medium truncate">{file.name}</span>
        )}
      </div>

      {/* Media Container */}
      <div
        className="max-w-[90vw] max-h-[85vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {mediaUrl ? (
          isVideo ? (
            <video
              src={mediaUrl}
              controls
              autoPlay
              className="max-w-full max-h-[85vh] rounded-lg animate-in fade-in zoom-in-95 duration-300"
            />
          ) : isPdf ? (
            <iframe
              src={mediaUrl}
              className="w-[80vw] h-[85vh] bg-white rounded-lg animate-in fade-in zoom-in-95 duration-300"
              frameBorder="0"
            />
          ) : isOfficeDoc ? (
            isLocalhost ? (
              <div className="flex flex-col items-center justify-center p-8 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20 text-center animate-in fade-in zoom-in-95 duration-300">
                <svg className="w-16 h-16 text-white/50 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <h3 className="text-xl font-bold text-white mb-2">미리보기를 불러올 수 없음</h3>
                <p className="text-white/70 max-w-md mb-6">
                  로컬 개발 환경(localhost)에서는 Google 문서 뷰어를 사용할 수 없습니다.
                  <br />
                  배포된 환경에서 정상적으로 작동합니다.
                </p>
                <button
                  onClick={() => window.open(mediaUrl, "_blank")}
                  className="px-6 py-2.5 bg-white text-gray-900 rounded-xl font-semibold hover:bg-gray-100 transition-colors"
                >
                  새 탭에서 열기
                </button>
              </div>
            ) : (
              <iframe
                src={`https://docs.google.com/gview?url=${encodeURIComponent(mediaUrl)}&embedded=true`}
                className="w-[80vw] h-[85vh] bg-white rounded-lg animate-in fade-in zoom-in-95 duration-300"
                frameBorder="0"
              />
            )
          ) : (
            <img
              src={mediaUrl}
              alt={file.name}
              className="max-w-full max-h-[85vh] object-contain rounded-lg animate-in fade-in zoom-in-95 duration-300"
            />
          )
        ) : (
          <div className="flex items-center justify-center w-32 h-32 bg-white/5 rounded-2xl">
            <img
              src="/logo_black.png"
              alt=""
              className="w-16 h-16 object-contain invert opacity-30 animate-pulse"
            />
          </div>
        )}
      </div>

      {/* Bottom Info */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-4 text-sm text-white/60">
        {file.file_size && (
          <span>{formatFileSize(file.file_size)}</span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (mediaUrl) {
              window.open(mediaUrl, "_blank");
            }
          }}
          className="flex items-center gap-1.5 hover:text-white transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          새 탭에서 열기
        </button>
      </div>
    </div>
  );
}
