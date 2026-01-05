"use client";

import { useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { Workspace, WorkspaceCategory } from "../../lib/api";
import { WorkspaceCard } from "./WorkspaceCard";

interface WorkspaceGridProps {
  workspaces: Workspace[];
  categories: WorkspaceCategory[];
  workspaceCategoryMap: Record<number, number[]>;
  selectedCategoryId: number | null;
  activeId: number | null;
  overId: string | null;
  isTransitioning: boolean;
  sortWorkspacesByCategory: (workspaceList: Workspace[], categoryKey: string) => Workspace[];
  onWorkspaceClick: (workspaceId: number) => void;
}

function DroppableArea({
  id,
  children,
  isOver,
  color,
}: {
  id: string;
  children: React.ReactNode;
  isOver: boolean;
  color?: string;
}) {
  const { setNodeRef } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`p-3 -m-3 transition-all duration-200 ${
        isOver ? "bg-white/5 scale-[1.01]" : ""
      }`}
      style={isOver && color ? { backgroundColor: `${color}15` } : undefined}
    >
      {children}
    </div>
  );
}

export function WorkspaceGrid({
  workspaces,
  categories,
  workspaceCategoryMap,
  selectedCategoryId,
  activeId,
  overId,
  isTransitioning,
  sortWorkspacesByCategory,
  onWorkspaceClick,
}: WorkspaceGridProps) {
  // Pre-calculate visible categories with their workspaces
  const visibleCategories = useMemo(() => {
    return categories
      .map((category) => {
        const categoryKey = `category-${category.id}`;
        const rawCategoryWorkspaces = workspaces.filter(ws =>
          workspaceCategoryMap[ws.id]?.includes(category.id)
        );
        const categoryWorkspaces = sortWorkspacesByCategory(rawCategoryWorkspaces, categoryKey);
        const showSection = categoryWorkspaces.length > 0 || (activeId !== null);
        return { category, categoryKey, categoryWorkspaces, showSection };
      })
      .filter(item => item.showSection);
  }, [categories, workspaces, workspaceCategoryMap, sortWorkspacesByCategory, activeId]);

  if (selectedCategoryId === null) {
    // All view: grouped by category
    return (
      <div className={`transition-opacity duration-150 ${isTransitioning ? "opacity-0" : "opacity-100"}`}>
        {visibleCategories.map(({ category, categoryKey, categoryWorkspaces }, index) => {
          const isDragOver = overId === categoryKey;
          const isFirst = index === 0;

          return (
            <div key={category.id}>
              {/* Separator line between categories - outside DroppableArea */}
              {!isFirst && (
                <div className="border-t border-white/10 my-8" />
              )}
              <DroppableArea
                id={categoryKey}
                isOver={isDragOver}
                color={category.color}
              >
                {/* Category Header */}
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: category.color }}
                />
                <h3 className="text-sm font-medium text-white/70">
                  {category.name}
                </h3>
                <span className="text-sm text-white/30">
                  ({categoryWorkspaces.length})
                </span>
              </div>
              {/* Category Workspaces */}
              <SortableContext items={categoryWorkspaces.map(w => w.id)} strategy={rectSortingStrategy}>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {categoryWorkspaces.map((workspace) => (
                    <WorkspaceCard
                      key={workspace.id}
                      workspace={workspace}
                      categories={categories}
                      workspaceCategoryMap={workspaceCategoryMap}
                      onClick={() => onWorkspaceClick(workspace.id)}
                    />
                  ))}
                  {/* Empty drop zone */}
                  {isDragOver && categoryWorkspaces.length === 0 && (
                    <div className="p-5 border-2 border-dashed border-white/20 bg-white/5 animate-pulse">
                      <div className="h-2 w-8 bg-white/20 mb-3" />
                      <div className="h-4 w-24 bg-white/20 mb-1" />
                      <div className="h-3 w-16 bg-white/10 mb-4" />
                    </div>
                  )}
                </div>
              </SortableContext>
              </DroppableArea>
            </div>
          );
        })}

        {/* Uncategorized workspaces */}
        <UncategorizedSection
          workspaces={workspaces}
          categories={categories}
          workspaceCategoryMap={workspaceCategoryMap}
          activeId={activeId}
          overId={overId}
          sortWorkspacesByCategory={sortWorkspacesByCategory}
          onWorkspaceClick={onWorkspaceClick}
        />
      </div>
    );
  }

  // Specific category selected: grid
  const categoryKey = `category-${selectedCategoryId}`;
  const rawFilteredWorkspaces = workspaces.filter(ws =>
    workspaceCategoryMap[ws.id]?.includes(selectedCategoryId)
  );
  const filteredWorkspaces = sortWorkspacesByCategory(rawFilteredWorkspaces, categoryKey);

  return (
    <div className={`transition-opacity duration-150 ${isTransitioning ? "opacity-0" : "opacity-100"}`}>
      <SortableContext items={filteredWorkspaces.map(w => w.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredWorkspaces.map((workspace) => (
            <WorkspaceCard
              key={workspace.id}
              workspace={workspace}
              categories={categories}
              workspaceCategoryMap={workspaceCategoryMap}
              onClick={() => onWorkspaceClick(workspace.id)}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

interface UncategorizedSectionProps {
  workspaces: Workspace[];
  categories: WorkspaceCategory[];
  workspaceCategoryMap: Record<number, number[]>;
  activeId: number | null;
  overId: string | null;
  sortWorkspacesByCategory: (workspaceList: Workspace[], categoryKey: string) => Workspace[];
  onWorkspaceClick: (workspaceId: number) => void;
}

function UncategorizedSection({
  workspaces,
  categories,
  workspaceCategoryMap,
  activeId,
  overId,
  sortWorkspacesByCategory,
  onWorkspaceClick,
}: UncategorizedSectionProps) {
  const rawUncategorizedWorkspaces = workspaces.filter(ws =>
    !workspaceCategoryMap[ws.id] || workspaceCategoryMap[ws.id].length === 0
  );
  const uncategorizedWorkspaces = sortWorkspacesByCategory(rawUncategorizedWorkspaces, "uncategorized");
  const isDragOver = overId === "uncategorized";
  const showSection = uncategorizedWorkspaces.length > 0 || (activeId !== null && categories.length > 0);

  if (!showSection) return null;

  return (
    <div>
      {/* Separator line - outside DroppableArea */}
      {categories.length > 0 && (
        <div className={`border-t my-8 transition-colors ${isDragOver ? "border-white/30" : "border-white/10"}`} />
      )}
      <DroppableArea id="uncategorized" isOver={isDragOver}>
        <SortableContext items={uncategorizedWorkspaces.map(w => w.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {uncategorizedWorkspaces.map((workspace) => (
              <WorkspaceCard
                key={workspace.id}
                workspace={workspace}
                categories={categories}
                workspaceCategoryMap={workspaceCategoryMap}
                onClick={() => onWorkspaceClick(workspace.id)}
              />
            ))}
            {/* Empty drop zone */}
            {isDragOver && uncategorizedWorkspaces.length === 0 && (
              <div className="p-5 border-2 border-dashed border-white/20 bg-white/5 animate-pulse">
                <div className="h-4 w-24 bg-white/20 mb-1" />
                <div className="h-3 w-16 bg-white/10 mb-4" />
              </div>
            )}
          </div>
        </SortableContext>
      </DroppableArea>
    </div>
  );
}
