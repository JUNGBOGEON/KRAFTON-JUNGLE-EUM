import { cn } from '../ui/utils';
import { Button } from '../ui/button';
import { 
  Home, 
  FileText, 
  ClipboardList, 
  BookOpen, 
  CreditCard, 
  LogOut,
  Monitor
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onLogout: () => void;
  teacherName: string;
}

const navigation = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'results', label: 'Results', icon: FileText },
  { id: 'tests', label: 'Tests', icon: ClipboardList },
  { id: 'resources', label: 'Resources', icon: BookOpen },
  { id: 'payment', label: 'Payment', icon: CreditCard },
];

export function Sidebar({ activeTab, onTabChange, onLogout, teacherName }: SidebarProps) {
  return (
    <div className="w-64 bg-slate-900 text-white flex flex-col h-full">
      {/* Logo and Brand */}
      <div className="p-6 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center">
            <Monitor className="w-4 h-4 text-slate-900" />
          </div>
          <div>
            <h1 className="font-semibold">EduPortal</h1>
            <p className="text-sm text-slate-400">Academic Platform</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <Button
                  variant="ghost"
                  className={cn(
                    "w-full justify-start gap-3 h-10 text-slate-300 hover:text-white hover:bg-slate-800",
                    activeTab === item.id && "bg-slate-800 text-white"
                  )}
                  onClick={() => onTabChange(item.id)}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User Profile and Logout */}
      <div className="p-4 border-t border-slate-700">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-slate-700 rounded-full flex items-center justify-center">
            <span className="text-sm font-semibold">
              {teacherName.split(' ').map(n => n[0]).join('').toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{teacherName}</p>
            <p className="text-xs text-slate-400">Teacher</p>
          </div>
        </div>
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 h-10 text-slate-300 hover:text-white hover:bg-slate-800"
          onClick={onLogout}
        >
          <LogOut className="w-4 h-4" />
          Logout
        </Button>
      </div>
    </div>
  );
}