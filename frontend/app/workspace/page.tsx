"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth-context";
import { apiClient, UserSearchResult } from "../lib/api";

// 임시 워크스페이스 데이터 (나중에 API로 대체)
const mockWorkspaces = [
  {
    id: 1,
    name: "프로젝트 A",
    members: [
      { id: 1, name: "김철수", profileImg: null },
      { id: 2, name: "이영희", profileImg: null },
      { id: 3, name: "박민수", profileImg: null },
      { id: 4, name: "정수진", profileImg: null },
      { id: 5, name: "최동훈", profileImg: null },
    ],
    lastActive: "방금 전",
  },
  {
    id: 2,
    name: "디자인 팀",
    members: [
      { id: 6, name: "홍길동", profileImg: null },
      { id: 7, name: "김미래", profileImg: null },
      { id: 8, name: "이현우", profileImg: null },
    ],
    lastActive: "2시간 전",
  },
];

export default function WorkspacePage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [isClosingModal, setIsClosingModal] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [createStep, setCreateStep] = useState<1 | 2>(1);

  // 멤버 초대 관련 state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<UserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleOpenModal = () => {
    setShowNewWorkspace(true);
    // 비디오 재생 시작
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play();
    }
  };

  const handleCloseModal = () => {
    setIsClosingModal(true);
    setTimeout(() => {
      setShowNewWorkspace(false);
      setIsClosingModal(false);
      setNewWorkspaceName("");
      setCreateStep(1);
      setSearchQuery("");
      setSearchResults([]);
      setSelectedMembers([]);
      // 비디오 일시정지
      if (videoRef.current) {
        videoRef.current.pause();
      }
    }, 1000);
  };

  // 유저 검색 (debounce 적용)
  const handleSearch = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const result = await apiClient.searchUsers(query);
      // 이미 선택된 멤버는 검색 결과에서 제외
      const filteredUsers = result.users.filter(
        (u) => !selectedMembers.some((m) => m.id === u.id)
      );
      setSearchResults(filteredUsers);
    } catch (error) {
      console.error("Search failed:", error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [selectedMembers]);

  // 검색어 변경 시 debounce 적용
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      handleSearch(searchQuery);
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, handleSearch]);

  // 멤버 추가
  const handleAddMember = (user: UserSearchResult) => {
    setSelectedMembers((prev) => [...prev, user]);
    setSearchQuery("");
    setSearchResults([]);
  };

  // 멤버 제거
  const handleRemoveMember = (userId: number) => {
    setSelectedMembers((prev) => prev.filter((m) => m.id !== userId));
  };

  // 다음 단계로 이동
  const handleNextStep = () => {
    if (newWorkspaceName.trim()) {
      setCreateStep(2);
    }
  };

  // 이전 단계로 이동
  const handlePrevStep = () => {
    setCreateStep(1);
    setSearchQuery("");
    setSearchResults([]);
  };

  // 워크스페이스 생성 완료
  const handleCreateWorkspace = () => {
    console.log("Creating workspace:", {
      name: newWorkspaceName,
      members: selectedMembers.map((m) => m.id),
    });
    // TODO: API 호출하여 워크스페이스 생성
    handleCloseModal();
  };

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/");
    }
  }, [isLoading, isAuthenticated, router]);

  const handleLogout = async () => {
    await logout();
    router.push("/");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <img
          src="/kor_eum_black.png"
          alt="Loading"
          className="w-12 h-12 animate-pulse"
        />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-white relative overflow-hidden">
      
      {/* Background Images */}
      <img
        src="/workspace-left-top-background.png"
        alt=""
        className="fixed top-10 -left-10 h-[26vh] w-auto pointer-events-none select-none opacity-40"
      />
      <img
        src="/workspace-right-background.png"
        alt=""
        className="fixed bottom-0 -right-20 h-screen w-auto pointer-events-none select-none opacity-50"
      />

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-black/5">
        <div className="max-w-6xl mx-auto px-8 h-16 flex items-center justify-between">
          {/* Logo */}
          <img src="/eum_black.png" alt="EUM" className="h-6" />

          {/* Profile */}
          <div className="relative">
            <button
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              className="flex items-center gap-3 hover:opacity-70 transition-opacity"
            >
              {user.profileImg ? (
                <img
                  src={user.profileImg}
                  alt={user.nickname}
                  className="w-9 h-9 rounded-full object-cover"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-black flex items-center justify-center">
                  <span className="text-sm font-medium text-white">
                    {user.nickname.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
            </button>

            {/* Profile Dropdown */}
            {showProfileMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowProfileMenu(false)}
                />
                <div className="absolute right-0 mt-2 w-64 bg-white border border-black/10 shadow-lg z-20">
                  <div className="p-4 border-b border-black/5">
                    <p className="font-medium text-black">{user.nickname}</p>
                    <p className="text-sm text-black/50 mt-0.5">{user.email}</p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full px-4 py-3 text-left text-sm text-black/70 hover:bg-black/5 transition-colors"
                  >
                    로그아웃
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="pt-16 relative z-10">
        <div className="max-w-4xl ml-8 lg:ml-16 xl:ml-24 px-8 py-16">
          {/* Greeting */}
          <div className="mb-16">
            <h1 className="text-4xl font-light text-black">
              안녕하세요, <span className="font-medium">{user.nickname}</span>님
            </h1>
            <p className="text-black/40 mt-2">워크스페이스를 선택하거나 새로 만들어보세요</p>
          </div>

          {/* Workspace Section */}
          <section>
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-sm font-medium text-black/40 uppercase tracking-wider">
                내 워크스페이스
              </h2>
            </div>

            {/* Workspace Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* New Workspace Card */}
              <button
                className="group h-56 border-2 border-dashed border-black/10 hover:border-black/30 transition-all duration-300 flex flex-col items-center justify-center gap-4 hover:bg-black/[0.01]"
                onClick={handleOpenModal}
              >
                <img
                  src="/logo_black.png"
                  alt=""
                  className="w-12 h-12 object-contain opacity-20 group-hover:opacity-40 group-hover:scale-110 transition-all duration-300"
                />
                <span className="text-sm text-black/35 group-hover:text-black/60 transition-colors duration-300">
                  새 워크스페이스
                </span>
              </button>

              {/* Workspace Cards */}
              {mockWorkspaces.map((workspace) => {
                const displayMembers = workspace.members.slice(0, 4);
                const remainingCount = workspace.members.length - 4;

                return (
                  <button
                    key={workspace.id}
                    className="group h-56 border border-black/10 hover:border-black/25 bg-white hover:shadow-lg transition-all duration-300 text-left p-7 flex flex-col justify-between"
                    onClick={() => {/* TODO: 워크스페이스 입장 */}}
                  >
                    <div>
                      <h3 className="text-xl font-medium text-black mb-6">
                        {workspace.name}
                      </h3>

                      {/* Member Avatars */}
                      <div className="flex items-center">
                        <div className="flex -space-x-2">
                          {displayMembers.map((member, index) => (
                            <div
                              key={member.id}
                              className="w-8 h-8 rounded-full border-2 border-white bg-black/10 flex items-center justify-center"
                              style={{ zIndex: displayMembers.length - index }}
                            >
                              {member.profileImg ? (
                                <img
                                  src={member.profileImg}
                                  alt={member.name}
                                  className="w-full h-full rounded-full object-cover"
                                />
                              ) : (
                                <span className="text-xs font-medium text-black/50">
                                  {member.name.charAt(0)}
                                </span>
                              )}
                            </div>
                          ))}
                          {remainingCount > 0 && (
                            <div
                              className="w-8 h-8 rounded-full border-2 border-white bg-black flex items-center justify-center"
                              style={{ zIndex: 0 }}
                            >
                              <span className="text-xs font-medium text-white">
                                +{remainingCount}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-black/30">
                        {workspace.lastActive}
                      </span>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center group-hover:bg-black/5 transition-colors duration-300">
                        <svg
                          className="w-4 h-4 text-black/25 group-hover:text-black/50 group-hover:translate-x-0.5 transition-all duration-300"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Empty State (워크스페이스가 없을 때) */}
            {mockWorkspaces.length === 0 && (
              <div className="text-center py-16">
                <p className="text-black/30">아직 워크스페이스가 없습니다</p>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* New Workspace Modal - 항상 렌더링하여 비디오 프리로드 */}
      <div
        className={`fixed inset-0 z-[100] flex transition-all duration-1000 ${
          showNewWorkspace
            ? isClosingModal
              ? 'translate-y-full'
              : 'translate-y-0'
            : 'translate-y-full pointer-events-none'
        }`}
        style={{ transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' }}
      >
        {/* Left Side - Background Video */}
        <div className="w-[70%] h-full relative overflow-hidden">
          <video
            ref={videoRef}
            src="/new-workspace-page-background-video.mp4"
            className="w-full h-full object-cover"
            muted
            loop
            playsInline
            preload="auto"
          />
          {/* Close Button */}
          <button
            onClick={handleCloseModal}
            className="absolute top-8 left-8 w-10 h-10 flex items-center justify-center bg-black/30 backdrop-blur-sm rounded-full text-white/80 hover:bg-black/50 hover:text-white transition-all"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Right Side - Form */}
        <div className="w-[30%] h-full bg-white flex flex-col justify-center px-12 border-l border-black/10">
          <div className="w-full">
            {/* Step Indicator */}
            <div className="flex items-center gap-2 mb-6">
              <div className={`w-2 h-2 rounded-full transition-colors ${createStep === 1 ? 'bg-black' : 'bg-black/20'}`} />
              <div className={`w-2 h-2 rounded-full transition-colors ${createStep === 2 ? 'bg-black' : 'bg-black/20'}`} />
            </div>

            {/* Step 1: 워크스페이스 이름 */}
            {createStep === 1 && (
              <>
                <p className="text-xs text-black/30 uppercase tracking-[0.2em] mb-2">
                  STEP 1
                </p>
                <h2 className="text-2xl font-medium text-black mb-8">
                  워크스페이스 이름
                </h2>

                <div className="space-y-12">
                  <div>
                    <input
                      type="text"
                      value={newWorkspaceName}
                      onChange={(e) => setNewWorkspaceName(e.target.value)}
                      placeholder="이름 입력"
                      className="no-focus-outline w-full py-3 text-lg text-black border-x-0 border-t-0 border-b border-black/10 bg-transparent placeholder:text-black/20"
                      autoFocus
                    />
                  </div>

                  {/* Next Button */}
                  <button
                    onClick={handleNextStep}
                    disabled={!newWorkspaceName.trim()}
                    className={`group flex items-center gap-3 transition-all duration-300 ${
                      newWorkspaceName.trim()
                        ? 'text-black cursor-pointer'
                        : 'text-black/20 cursor-not-allowed'
                    }`}
                  >
                    <span className="text-sm font-medium tracking-wide">다음</span>
                    <div className={`w-8 h-8 rounded-full border flex items-center justify-center transition-all duration-300 ${
                      newWorkspaceName.trim()
                        ? 'border-black group-hover:bg-black group-hover:text-white'
                        : 'border-black/20'
                    }`}>
                      <svg
                        className={`w-4 h-4 transition-transform duration-300 ${newWorkspaceName.trim() ? 'group-hover:translate-x-0.5' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </div>
                  </button>
                </div>
              </>
            )}

            {/* Step 2: 멤버 초대 */}
            {createStep === 2 && (
              <>
                <p className="text-xs text-black/30 uppercase tracking-[0.2em] mb-2">
                  STEP 2
                </p>
                <h2 className="text-2xl font-medium text-black mb-2">
                  멤버 초대
                </h2>
                <p className="text-sm text-black/40 mb-6">
                  이름 또는 이메일로 검색하세요
                </p>

                <div className="space-y-6">
                  {/* Search Input */}
                  <div className="relative">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="검색..."
                      className="no-focus-outline w-full py-3 pl-10 text-base text-black border border-black/10 bg-transparent placeholder:text-black/20 rounded-lg"
                      autoFocus
                    />
                    <svg
                      className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-black/30"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                    {isSearching && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="w-4 h-4 border-2 border-black/20 border-t-black/60 rounded-full animate-spin" />
                      </div>
                    )}
                  </div>

                  {/* Search Results */}
                  {searchResults.length > 0 && (
                    <div className="border border-black/10 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                      {searchResults.map((result) => (
                        <button
                          key={result.id}
                          onClick={() => handleAddMember(result)}
                          className="w-full flex items-center gap-3 p-3 hover:bg-black/5 transition-colors text-left"
                        >
                          {result.profile_img ? (
                            <img
                              src={result.profile_img}
                              alt={result.nickname}
                              className="w-8 h-8 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-black/10 flex items-center justify-center">
                              <span className="text-xs font-medium text-black/50">
                                {result.nickname.charAt(0).toUpperCase()}
                              </span>
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-black truncate">
                              {result.nickname}
                            </p>
                            <p className="text-xs text-black/40 truncate">
                              {result.email}
                            </p>
                          </div>
                          <svg
                            className="w-5 h-5 text-black/30"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={1.5}
                              d="M12 4v16m8-8H4"
                            />
                          </svg>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* No Results */}
                  {searchQuery.length >= 2 && !isSearching && searchResults.length === 0 && (
                    <p className="text-sm text-black/40 text-center py-4">
                      검색 결과가 없습니다
                    </p>
                  )}

                  {/* Selected Members */}
                  {selectedMembers.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-black/40 uppercase tracking-wider">
                        초대할 멤버 ({selectedMembers.length})
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {selectedMembers.map((member) => (
                          <div
                            key={member.id}
                            className="flex items-center gap-2 bg-black/5 rounded-full pl-1 pr-2 py-1"
                          >
                            {member.profile_img ? (
                              <img
                                src={member.profile_img}
                                alt={member.nickname}
                                className="w-6 h-6 rounded-full object-cover"
                              />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-black/10 flex items-center justify-center">
                                <span className="text-[10px] font-medium text-black/50">
                                  {member.nickname.charAt(0).toUpperCase()}
                                </span>
                              </div>
                            )}
                            <span className="text-sm text-black/70">
                              {member.nickname}
                            </span>
                            <button
                              onClick={() => handleRemoveMember(member.id)}
                              className="w-4 h-4 rounded-full hover:bg-black/10 flex items-center justify-center transition-colors"
                            >
                              <svg
                                className="w-3 h-3 text-black/40"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M6 18L18 6M6 6l12 12"
                                />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex items-center justify-between pt-4">
                    {/* Back Button */}
                    <button
                      onClick={handlePrevStep}
                      className="group flex items-center gap-2 text-black/50 hover:text-black transition-colors"
                    >
                      <svg
                        className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M15 19l-7-7 7-7"
                        />
                      </svg>
                      <span className="text-sm">이전</span>
                    </button>

                    {/* Create / Skip Button */}
                    <button
                      onClick={handleCreateWorkspace}
                      className="group flex items-center gap-3 text-black"
                    >
                      <span className="text-sm font-medium tracking-wide">
                        {selectedMembers.length > 0 ? '완료' : '건너뛰기'}
                      </span>
                      <div className="w-8 h-8 rounded-full border border-black flex items-center justify-center group-hover:bg-black group-hover:text-white transition-all duration-300">
                        <svg
                          className="w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-300"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </div>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
