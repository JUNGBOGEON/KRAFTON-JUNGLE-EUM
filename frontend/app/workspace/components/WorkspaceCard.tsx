"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Workspace, WorkspaceCategory } from "../../lib/api";
import { filterActiveMembers } from "../../lib/utils";

interface WorkspaceCardProps {
  workspace: Workspace;
  categories: WorkspaceCategory[];
  workspaceCategoryMap: Record<number, number[]>;
  onClick: () => void;
}

export function WorkspaceCard({
  workspace,
  categories,
  workspaceCategoryMap,
  onClick,
}: WorkspaceCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
    isOver,
  } = useSortable({
    id: workspace.id,
    // Disable layout animations - instant movement
    animateLayoutChanges: () => false,
  });

  const activeMembers = filterActiveMembers(workspace.members || []);
  const displayMembers = activeMembers.slice(0, 5);
  const wsCategories = workspaceCategoryMap[workspace.id] || [];

  // Get the first category's color for hover border
  const primaryCategory = wsCategories.length > 0
    ? categories.find(c => c.id === wsCategories[0])
    : null;
  const categoryColor = primaryCategory?.color;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    // No transition - instant movement
    "--category-color": categoryColor || "transparent",
  } as React.CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative group touch-none ${
        isDragging ? "opacity-50 scale-[1.02] z-50" : ""
      } ${isOver ? "ring-2 ring-white/40" : ""}`}
      {...attributes}
      {...listeners}
    >
      {/* Hover border overlay */}
      {categoryColor && !isDragging && (
        <div
          className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10"
          style={{ boxShadow: `inset 0 0 0 2px ${categoryColor}` }}
        />
      )}
      <button
        onClick={onClick}
        className={`w-full h-36 bg-[#222] group-hover:bg-[#262626] transition-colors text-left cursor-grab active:cursor-grabbing overflow-hidden relative ${
          isDragging ? "shadow-2xl shadow-black/50" : ""
        }`}
      >
        {/* Right - Owner Profile Image */}
        <div className="absolute right-0 top-0 w-[45%] h-full">
          {workspace.owner?.profile_img ? (
            <img
              src={workspace.owner.profile_img}
              alt=""
              className="absolute inset-0 w-full h-full object-cover object-center opacity-50 group-hover:opacity-60 transition-opacity blur-[0.5px]"
            />
          ) : (
            <div className="w-full h-full bg-white/5 flex items-center justify-center">
              <span className="text-4xl text-white/15">{workspace.owner?.nickname?.charAt(0) || "?"}</span>
            </div>
          )}
          {/* Gradient overlay for seamless blend */}
          <div className="absolute inset-0 bg-gradient-to-r from-[#222] via-[#222]/80 via-30% to-transparent group-hover:from-[#262626] group-hover:via-[#262626]/80 transition-colors" />
        </div>

        {/* Left - Content */}
        <div className="relative z-10 h-full flex flex-col justify-between p-5 w-[55%]">
          {/* Name & Owner */}
          <div>
            <h3 className="text-xl font-semibold text-white truncate">
              {workspace.name}
            </h3>
            <p className="text-sm text-white/50 truncate mt-1">
              {workspace.owner?.nickname || "Unknown"}
            </p>
          </div>

          {/* Avatars */}
          <div className="flex items-center -space-x-2">
            {displayMembers.map((member) => (
              <div
                key={member.id}
                className="w-7 h-7 rounded-full bg-white/15 ring-2 ring-[#222] group-hover:ring-[#262626] overflow-hidden transition-colors"
              >
                {member.user?.profile_img ? (
                  <img src={member.user.profile_img} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-[10px] text-white/50">{member.user?.nickname?.charAt(0)}</span>
                  </div>
                )}
              </div>
            ))}
            {activeMembers.length > 5 && (
              <div className="w-7 h-7 rounded-full bg-white/10 ring-2 ring-[#222] group-hover:ring-[#262626] flex items-center justify-center transition-colors">
                <span className="text-[10px] text-white/50">+{activeMembers.length - 5}</span>
              </div>
            )}
          </div>
        </div>
      </button>
    </div>
  );
}

// Overlay component for drag preview
export function WorkspaceCardOverlay({
  workspace,
  categories,
  workspaceCategoryMap,
}: Omit<WorkspaceCardProps, "onClick">) {
  const activeMembers = filterActiveMembers(workspace.members || []);
  const displayMembers = activeMembers.slice(0, 5);

  return (
    <div className="w-[280px] opacity-90 rotate-2 shadow-2xl shadow-black/50">
      <div className="h-36 bg-[#2a2a2a] text-left overflow-hidden relative">
        {/* Right - Owner Profile Image */}
        <div className="absolute right-0 top-0 w-[45%] h-full">
          {workspace.owner?.profile_img ? (
            <img
              src={workspace.owner.profile_img}
              alt=""
              className="absolute inset-0 w-full h-full object-cover object-center opacity-50 blur-[0.5px]"
            />
          ) : (
            <div className="w-full h-full bg-white/5 flex items-center justify-center">
              <span className="text-4xl text-white/15">{workspace.owner?.nickname?.charAt(0) || "?"}</span>
            </div>
          )}
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-r from-[#2a2a2a] via-[#2a2a2a]/80 via-30% to-transparent" />
        </div>

        {/* Left - Content */}
        <div className="relative z-10 h-full flex flex-col justify-between p-5 w-[55%]">
          {/* Name & Owner */}
          <div>
            <h3 className="text-xl font-semibold text-white truncate">
              {workspace.name}
            </h3>
            <p className="text-sm text-white/50 truncate mt-1">
              {workspace.owner?.nickname || "Unknown"}
            </p>
          </div>

          {/* Avatars */}
          <div className="flex items-center -space-x-2">
            {displayMembers.map((member) => (
              <div
                key={member.id}
                className="w-7 h-7 rounded-full bg-white/15 ring-2 ring-[#2a2a2a] overflow-hidden"
              >
                {member.user?.profile_img ? (
                  <img src={member.user.profile_img} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-[10px] text-white/50">{member.user?.nickname?.charAt(0)}</span>
                  </div>
                )}
              </div>
            ))}
            {activeMembers.length > 5 && (
              <div className="w-7 h-7 rounded-full bg-white/10 ring-2 ring-[#2a2a2a] flex items-center justify-center">
                <span className="text-[10px] text-white/50">+{activeMembers.length - 5}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
