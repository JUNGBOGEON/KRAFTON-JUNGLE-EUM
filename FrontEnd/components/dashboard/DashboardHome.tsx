import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { 
  BookOpen, 
  Users, 
  Upload,
  ClipboardList,
  Calendar,
  TrendingUp,
  Clock,
  FileText,
  Video,
  Image,
  CheckCircle,
  AlertCircle,
  Plus
} from 'lucide-react';

interface DashboardHomeProps {
  teacherName: string;
}

export function DashboardHome({ teacherName }: DashboardHomeProps) {
  // Mock data - in real app this would come from API
  const teacherStats = {
    totalClasses: 4,
    totalStudents: 156,
    resourcesUploaded: 23,
    activeCBTs: 3
  };

  const teacherClasses = [
    { 
      name: 'Primary 4A', 
      subject: 'Mathematics', 
      students: 32, 
      nextClass: '2023-12-15 09:00',
      recentActivity: 'Uploaded Chapter 5 exercises'
    },
    { 
      name: 'Primary 4B', 
      subject: 'Mathematics', 
      students: 28, 
      nextClass: '2023-12-15 10:30',
      recentActivity: 'Created CBT test for fractions'
    },
    { 
      name: 'Primary 5A', 
      subject: 'Mathematics', 
      students: 35, 
      nextClass: '2023-12-15 11:30',
      recentActivity: 'Uploaded homework results'
    },
    { 
      name: 'Primary 5B', 
      subject: 'Mathematics', 
      students: 31, 
      nextClass: '2023-12-15 14:00',
      recentActivity: 'Assigned continuous assessment'
    }
  ];

  const recentActivities = [
    { 
      type: 'resource_upload', 
      title: 'Uploaded "Quadratic Equations - Past Questions"', 
      time: '2 hours ago',
      class: 'Primary 5A'
    },
    { 
      type: 'cbt_created', 
      title: 'Created CBT test "Fractions and Decimals"', 
      time: '4 hours ago',
      class: 'Primary 4B'
    },
    { 
      type: 'results_uploaded', 
      title: 'Uploaded results for Mathematics test', 
      time: '1 day ago',
      class: 'Primary 4A'
    },
    { 
      type: 'assessment_assigned', 
      title: 'Assigned continuous assessment', 
      time: '2 days ago',
      class: 'Primary 5B'
    }
  ];

  const pendingTasks = [
    { 
      task: 'Review and approve CBT test for Primary 4A', 
      priority: 'high',
      dueDate: '2023-12-15'
    },
    { 
      task: 'Upload results for Primary 5A Mathematics test', 
      priority: 'medium',
      dueDate: '2023-12-16'
    },
    { 
      task: 'Create continuous assessment for Primary 4B', 
      priority: 'medium',
      dueDate: '2023-12-17'
    }
  ];

  const resourceStats = {
    totalResources: 23,
    pdfs: 15,
    videos: 5,
    images: 3,
    totalDownloads: 234
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'resource_upload':
        return <Upload className="w-4 h-4 text-blue-500" />;
      case 'cbt_created':
        return <ClipboardList className="w-4 h-4 text-green-500" />;
      case 'results_uploaded':
        return <FileText className="w-4 h-4 text-purple-500" />;
      case 'assessment_assigned':
        return <CheckCircle className="w-4 h-4 text-orange-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'destructive';
      case 'medium': return 'secondary';
      case 'low': return 'outline';
      default: return 'secondary';
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Welcome Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Welcome back, {teacherName}!</h1>
        <p className="text-gray-600 mt-1">Here's your teaching overview and recent activities.</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Classes Teaching</p>
                <p className="text-2xl font-semibold text-gray-900">{teacherStats.totalClasses}</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <BookOpen className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Students</p>
                <p className="text-2xl font-semibold text-gray-900">{teacherStats.totalStudents}</p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <Users className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Resources Uploaded</p>
                <p className="text-2xl font-semibold text-gray-900">{teacherStats.resourcesUploaded}</p>
              </div>
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                <Upload className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active CBT Tests</p>
                <p className="text-2xl font-semibold text-gray-900">{teacherStats.activeCBTs}</p>
              </div>
              <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                <ClipboardList className="w-6 h-6 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Your Classes */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="w-5 h-5" />
              Your Classes
            </CardTitle>
            <p className="text-sm text-gray-600">Classes you're currently teaching</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {teacherClasses.map((classItem, index) => (
              <div key={index} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-medium">{classItem.name}</h4>
                    <Badge variant="secondary" className="text-xs">
                      {classItem.subject}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-600 mb-1">{classItem.students} students</p>
                  <p className="text-xs text-gray-500">{classItem.recentActivity}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">Next class</p>
                  <p className="text-xs text-gray-600">{new Date(classItem.nextClass).toLocaleDateString()}</p>
                  <p className="text-xs text-gray-600">{new Date(classItem.nextClass).toLocaleTimeString()}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5" />
              Quick Actions
            </CardTitle>
            <p className="text-sm text-gray-600">Common tasks you can do quickly</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" className="w-full justify-start gap-2">
              <Upload className="w-4 h-4" />
              Upload Student Results
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2">
              <ClipboardList className="w-4 h-4" />
              Create CBT Test
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2">
              <FileText className="w-4 h-4" />
              Upload Learning Resource
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2">
              <CheckCircle className="w-4 h-4" />
              Assign Continuous Assessment
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2">
              <Calendar className="w-4 h-4" />
              View Class Schedule
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activities */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Recent Activities
            </CardTitle>
            <p className="text-sm text-gray-600">Your recent teaching activities</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentActivities.map((activity, index) => (
              <div key={index} className="flex items-start gap-3 p-3 border rounded-lg">
                <div className="mt-1">
                  {getActivityIcon(activity.type)}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">{activity.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-xs text-gray-500">{activity.time}</p>
                    <span className="text-xs text-gray-400">•</span>
                    <p className="text-xs text-gray-500">{activity.class}</p>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Pending Tasks */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              Pending Tasks
            </CardTitle>
            <p className="text-sm text-gray-600">Tasks that need your attention</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingTasks.map((task, index) => (
              <div key={index} className="flex items-start justify-between p-3 border rounded-lg">
                <div className="flex-1">
                  <p className="text-sm font-medium">{task.task}</p>
                  <p className="text-xs text-gray-500 mt-1">Due: {new Date(task.dueDate).toLocaleDateString()}</p>
                </div>
                <Badge variant={getPriorityColor(task.priority)} className="text-xs">
                  {task.priority}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Resource Statistics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Your Teaching Resources
          </CardTitle>
          <p className="text-sm text-gray-600">Overview of resources you've uploaded</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="text-center">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-2">
                <FileText className="w-6 h-6 text-blue-600" />
              </div>
              <p className="text-lg font-semibold">{resourceStats.totalResources}</p>
              <p className="text-sm text-gray-600">Total Resources</p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center mx-auto mb-2">
                <FileText className="w-6 h-6 text-red-600" />
              </div>
              <p className="text-lg font-semibold">{resourceStats.pdfs}</p>
              <p className="text-sm text-gray-600">PDFs</p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mx-auto mb-2">
                <Video className="w-6 h-6 text-green-600" />
              </div>
              <p className="text-lg font-semibold">{resourceStats.videos}</p>
              <p className="text-sm text-gray-600">Videos</p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mx-auto mb-2">
                <Image className="w-6 h-6 text-purple-600" />
              </div>
              <p className="text-lg font-semibold">{resourceStats.images}</p>
              <p className="text-sm text-gray-600">Images</p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mx-auto mb-2">
                <TrendingUp className="w-6 h-6 text-orange-600" />
              </div>
              <p className="text-lg font-semibold">{resourceStats.totalDownloads}</p>
              <p className="text-sm text-gray-600">Downloads</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}