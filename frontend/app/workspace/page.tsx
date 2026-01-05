"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth-context";
import { usePresence } from "../contexts/presence-context";
import EditProfileModal from "../../components/EditProfileModal";
import { Search, X, Loader2, ArrowRight } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

// Local components
import {
  LeftPanel,
  WorkspaceHeader,
  CategoryTabs,
  WorkspaceGrid,
  CategoryModal,
  CreateWorkspaceModal,
  WorkspaceCardOverlay,
} from "./components";

// Local hooks
import {
  useWorkspaces,
  useCategories,
  useDragDrop,
  useCreateWorkspace,
} from "./hooks";

console.log("[WorkspacePage] Module loaded");

export default function WorkspacePage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading, logout, refreshUser } = useAuth();
  const { presenceMap, subscribePresence } = usePresence();

  // Profile menu state
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [isEditProfileModalOpen, setIsEditProfileModalOpen] = useState(false);

  // Custom hooks
  const {
    workspaces,
    isLoadingWorkspaces,
    hasMore,
    isLoadingMore,
    totalWorkspaces,
    workspaceCategoryMap,
    searchQuery,
    setSearchQuery,
    fetchWorkspaces,
    updateCategoryMap,
  } = useWorkspaces(isAuthenticated);

  const {
    categories,
    selectedCategoryId,
    isTransitioning,
    showCategoryModal,
    categoryName,
    categoryColor,
    editingCategory,
    categoryMenuOpen,
    isCreatingCategory,
    setCategoryName,
    setCategoryColor,
    setCategoryMenuOpen,
    handleCategoryChange,
    handleCreateCategory,
    handleUpdateCategory,
    handleDeleteCategory,
    handleCategoryReorder,
    openEditCategory,
    openCreateCategory,
    closeCategoryModal,
    moveWorkspaceToCategory,
    removeAllCategories,
  } = useCategories(isAuthenticated);

  const {
    activeId,
    overId,
    sortWorkspacesByCategory,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    reorderInCategory,
    addToCategory,
    removeFromCategoryOrder,
  } = useDragDrop();

  const createWorkspaceHook = useCreateWorkspace(fetchWorkspaces);

  // Infinite scroll ref
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Filtered workspaces for empty state check
  const filteredWorkspaces = useMemo(() => {
    if (selectedCategoryId === null) {
      return workspaces;
    }
    return workspaces.filter(ws =>
      workspaceCategoryMap[ws.id]?.includes(selectedCategoryId)
    );
  }, [workspaces, selectedCategoryId, workspaceCategoryMap]);

  // Get active workspace for drag overlay
  const activeWorkspace = useMemo(() => {
    if (!activeId) return null;
    return workspaces.find(w => w.id === activeId) || null;
  }, [activeId, workspaces]);

  // Auth redirect
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/");
    }
  }, [isLoading, isAuthenticated, router]);

  // Presence subscription
  useEffect(() => {
    if (workspaces.length > 0) {
      const allMemberIds = new Set<number>();
      workspaces.forEach(ws => {
        ws.members?.forEach(m => {
          if (m.user?.id) allMemberIds.add(m.user.id);
        });
      });
      if (allMemberIds.size > 0) {
        subscribePresence(Array.from(allMemberIds));
      }
    }
  }, [workspaces, subscribePresence]);

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore && !isLoadingWorkspaces) {
          fetchWorkspaces(false);
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, isLoadingWorkspaces, fetchWorkspaces]);

  // Helper to get sorted workspace IDs for a category
  const getSortedIdsForCategory = useCallback((categoryKey: string) => {
    let categoryWorkspaces: typeof workspaces;
    if (categoryKey === "uncategorized") {
      categoryWorkspaces = workspaces.filter(ws =>
        !workspaceCategoryMap[ws.id] || workspaceCategoryMap[ws.id].length === 0
      );
    } else {
      const categoryId = parseInt(categoryKey.replace("category-", ""));
      categoryWorkspaces = workspaces.filter(ws =>
        workspaceCategoryMap[ws.id]?.includes(categoryId)
      );
    }
    return sortWorkspacesByCategory(categoryWorkspaces, categoryKey).map(w => w.id);
  }, [workspaces, workspaceCategoryMap, sortWorkspacesByCategory]);

  // Find which category section a workspace belongs to (for visual ordering)
  const findWorkspaceCategoryKey = useCallback((workspaceId: number): string => {
    const wsCategories = workspaceCategoryMap[workspaceId] || [];
    if (wsCategories.length === 0) return "uncategorized";
    return `category-${wsCategories[0]}`;
  }, [workspaceCategoryMap]);

  // Handle drag end with category assignment or reorder
  const onDragEnd = useCallback(async (event: DragEndEvent) => {
    const result = handleDragEnd(event);
    if (!result) return;

    if (result.type === "category") {
      const activeWorkspaceId = result.workspaceId;
      const targetId = result.targetId;

      if (targetId.startsWith("category-")) {
        const categoryId = parseInt(targetId.replace("category-", ""));
        const currentCategories = workspaceCategoryMap[activeWorkspaceId] || [];
        // Remove from old category order
        const oldCategoryKey = findWorkspaceCategoryKey(activeWorkspaceId);
        removeFromCategoryOrder(oldCategoryKey, activeWorkspaceId);
        // Add to new category order at end
        addToCategory(targetId, activeWorkspaceId);
        // Update category assignment
        await moveWorkspaceToCategory(activeWorkspaceId, categoryId, currentCategories, updateCategoryMap);
      } else if (targetId === "uncategorized") {
        const currentCategories = workspaceCategoryMap[activeWorkspaceId] || [];
        // Remove from old category order
        const oldCategoryKey = findWorkspaceCategoryKey(activeWorkspaceId);
        removeFromCategoryOrder(oldCategoryKey, activeWorkspaceId);
        // Add to uncategorized order at end
        addToCategory("uncategorized", activeWorkspaceId);
        // Update category assignment
        await removeAllCategories(activeWorkspaceId, currentCategories, updateCategoryMap);
      }
      return;
    }

    if (result.type === "reorder") {
      const draggedId = result.activeId;
      const targetId = result.overId;

      // Get categories of both workspaces
      const draggedCategories = workspaceCategoryMap[draggedId] || [];
      const targetCategories = workspaceCategoryMap[targetId] || [];

      const draggedIsUncategorized = draggedCategories.length === 0;
      const targetIsUncategorized = targetCategories.length === 0;

      // Determine if they're in the same section
      const draggedCategoryKey = findWorkspaceCategoryKey(draggedId);
      const targetCategoryKey = findWorkspaceCategoryKey(targetId);
      const sameSection = draggedCategoryKey === targetCategoryKey;

      if (sameSection) {
        // Same section - just reorder using visual order
        const sortedIds = getSortedIdsForCategory(targetCategoryKey);
        reorderInCategory(targetCategoryKey, sortedIds, draggedId, targetId);
      } else {
        // Different sections - need to move between categories
        const targetSortedIds = getSortedIdsForCategory(targetCategoryKey);
        const targetPosition = targetSortedIds.indexOf(targetId);

        // Remove from old category order
        removeFromCategoryOrder(draggedCategoryKey, draggedId);
        // Add to new category order at target position
        addToCategory(targetCategoryKey, draggedId, targetPosition);

        // Update category assignment
        if (targetIsUncategorized && !draggedIsUncategorized) {
          await removeAllCategories(draggedId, draggedCategories, updateCategoryMap);
        } else if (!targetIsUncategorized) {
          const newCategoryId = targetCategories[0];
          await moveWorkspaceToCategory(draggedId, newCategoryId, draggedCategories, updateCategoryMap);
        }
      }
    }
  }, [handleDragEnd, workspaceCategoryMap, moveWorkspaceToCategory, removeAllCategories, updateCategoryMap, findWorkspaceCategoryKey, getSortedIdsForCategory, reorderInCategory, addToCategory, removeFromCategoryOrder]);

  const handleLogout = async () => {
    await logout();
    router.push("/");
  };

  const handleUpdateProfile = async () => {
    await refreshUser();
    setIsEditProfileModalOpen(false);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#1a1a1a]" style={{ fontFamily: "'Cafe24ProSlim', sans-serif" }}>
        <div className="w-1 h-8 bg-white/40" />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return null;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={onDragEnd}
    >
      <div
        className="min-h-screen bg-[#1a1a1a] text-white flex"
        style={{ fontFamily: "'Cafe24ProSlim', sans-serif" }}
      >
        {/* Left Panel */}
        <LeftPanel
          userNickname={user.nickname}
          workspaceCount={workspaces.length}
          onCreateWorkspace={createWorkspaceHook.openModal}
        />

        {/* Right Panel */}
        <div className="flex-1 flex flex-col min-h-screen">
          {/* Header */}
          <WorkspaceHeader
            user={{
              id: user.id,
              nickname: user.nickname,
              profileImg: user.profileImg,
              default_status: user.default_status,
            }}
            presenceStatus={presenceMap[user.id]?.status || user.default_status || "online"}
            showProfileMenu={showProfileMenu}
            onProfileMenuToggle={() => setShowProfileMenu(!showProfileMenu)}
            onProfileMenuClose={() => setShowProfileMenu(false)}
            onEditProfile={() => {
              setShowProfileMenu(false);
              setIsEditProfileModalOpen(true);
            }}
            onLogout={handleLogout}
            onInvitationAccepted={() => fetchWorkspaces()}
          />

          {/* Edit Profile Modal */}
          {isEditProfileModalOpen && user && (
            <EditProfileModal
              user={user}
              onClose={() => setIsEditProfileModalOpen(false)}
              onUpdate={handleUpdateProfile}
            />
          )}

          {/* Content */}
          <main className="flex-1 overflow-y-auto">
            <div className="px-6 lg:px-10 py-10">
              {/* Mobile Header */}
              <div className="lg:hidden mb-10">
                <p className="text-white/50 text-xs tracking-wide uppercase mb-2">Welcome back</p>
                <h1 className="text-3xl font-bold tracking-tight text-white">{user.nickname}</h1>
              </div>

              {/* Search & Filter Bar */}
              <div className="mb-6 space-y-4">
                {/* Search */}
                <div className="relative">
                  <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="워크스페이스 검색..."
                    className="w-full bg-[#222] py-3 pl-11 pr-4 text-sm text-white placeholder:text-white/30 outline-none focus:ring-1 focus:ring-white/20 transition-all"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* Categories */}
                <CategoryTabs
                  categories={categories}
                  selectedCategoryId={selectedCategoryId}
                  dragOverCategoryId={overId?.startsWith("category-") || overId === "uncategorized" ? overId as any : null}
                  categoryMenuOpen={categoryMenuOpen}
                  totalWorkspaces={totalWorkspaces}
                  onCategoryChange={handleCategoryChange}
                  onCategoryReorder={handleCategoryReorder}
                  onDragOver={() => {}}
                  onDragLeave={() => {}}
                  onDrop={() => {}}
                  onMenuToggle={setCategoryMenuOpen}
                  onEditCategory={openEditCategory}
                  onDeleteCategory={handleDeleteCategory}
                  onAddCategory={openCreateCategory}
                />
              </div>


              {/* Loading */}
              {isLoadingWorkspaces && (
                <div className="py-20 flex justify-center">
                  <div className="w-1 h-8 bg-white/40 animate-pulse" />
                </div>
              )}

              {/* Empty State */}
              {!isLoadingWorkspaces && (
                (workspaces.length === 0 || (selectedCategoryId !== null && filteredWorkspaces.length === 0)) && (
                  <div className={`py-20 text-center transition-opacity duration-150 ${isTransitioning ? "opacity-0" : "opacity-100"}`}>
                    <p className="text-white/40 text-lg mb-6">
                      {searchQuery
                        ? "검색 결과가 없습니다"
                        : selectedCategoryId
                        ? "이 카테고리에 워크스페이스가 없습니다"
                        : "아직 워크스페이스가 없습니다"}
                    </p>
                    {!searchQuery && !selectedCategoryId && (
                      <button
                        onClick={createWorkspaceHook.openModal}
                        className="inline-flex items-center gap-2 text-base text-white/80 hover:text-white border-b-2 border-white/30 hover:border-white pb-1 transition-all"
                      >
                        <span>첫 번째 워크스페이스 만들기</span>
                        <ArrowRight size={16} />
                      </button>
                    )}
                  </div>
                )
              )}

              {/* Workspace Grid */}
              {!isLoadingWorkspaces && workspaces.length > 0 && !(selectedCategoryId !== null && filteredWorkspaces.length === 0) && (
                <>
                  <WorkspaceGrid
                    workspaces={workspaces}
                    categories={categories}
                    workspaceCategoryMap={workspaceCategoryMap}
                    selectedCategoryId={selectedCategoryId}
                    activeId={activeId}
                    overId={overId}
                    isTransitioning={isTransitioning}
                    sortWorkspacesByCategory={sortWorkspacesByCategory}
                    onWorkspaceClick={(id) => router.push(`/workspace/${id}`)}
                  />

                  {/* Infinite Scroll Trigger */}
                  <div ref={loadMoreRef} className="py-4">
                    {isLoadingMore && (
                      <div className="flex justify-center">
                        <Loader2 size={20} className="animate-spin text-white/40" />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </main>
        </div>

        {/* Drag Overlay */}
        <DragOverlay dropAnimation={null}>
          {activeWorkspace ? (
            <WorkspaceCardOverlay
              workspace={activeWorkspace}
              categories={categories}
              workspaceCategoryMap={workspaceCategoryMap}
            />
          ) : null}
        </DragOverlay>

        {/* Create Workspace Modal */}
        <CreateWorkspaceModal
          isOpen={createWorkspaceHook.showModal}
          isClosing={createWorkspaceHook.isClosing}
          step={createWorkspaceHook.step}
          workspaceName={createWorkspaceHook.workspaceName}
          searchQuery={createWorkspaceHook.searchQuery}
          searchResults={createWorkspaceHook.searchResults}
          selectedMembers={createWorkspaceHook.selectedMembers}
          isSearching={createWorkspaceHook.isSearching}
          isCreating={createWorkspaceHook.isCreating}
          videoRef={createWorkspaceHook.videoRef}
          onWorkspaceNameChange={createWorkspaceHook.setWorkspaceName}
          onSearchQueryChange={createWorkspaceHook.setSearchQuery}
          onAddMember={createWorkspaceHook.addMember}
          onRemoveMember={createWorkspaceHook.removeMember}
          onNextStep={createWorkspaceHook.nextStep}
          onPrevStep={createWorkspaceHook.prevStep}
          onSubmit={createWorkspaceHook.createWorkspace}
          onClose={createWorkspaceHook.closeModal}
        />

        {/* Category Modal */}
        <CategoryModal
          isOpen={showCategoryModal}
          categoryName={categoryName}
          categoryColor={categoryColor}
          isEditing={!!editingCategory}
          isLoading={isCreatingCategory}
          onNameChange={setCategoryName}
          onColorChange={setCategoryColor}
          onSubmit={editingCategory ? handleUpdateCategory : handleCreateCategory}
          onClose={closeCategoryModal}
        />
      </div>
    </DndContext>
  );
}
