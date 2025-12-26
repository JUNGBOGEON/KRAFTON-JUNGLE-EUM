import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Progress } from '../ui/progress';
import {
  Upload,
  FileText,
  Video,
  Image,
  Download,
  Eye,
  Trash2,
  Search,
  Filter,
  CheckCircle,
  AlertCircle,
  Clock
} from 'lucide-react';

interface Resource {
  id: number;
  title: string;
  type: 'pdf' | 'video' | 'image' | 'document';
  subject: string;
  class: string;
  uploadDate: string;
  size: string;
  downloads: number;
  status: 'processing' | 'available' | 'error';
  description: string;
}

export function ResourceManagement() {
  const [uploadTab, setUploadTab] = useState('single');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterSubject, setFilterSubject] = useState('all');

  const [resourceDetails, setResourceDetails] = useState({
    title: '',
    description: '',
    subject: '',
    class: '',
    type: 'pdf' as 'pdf' | 'video' | 'image' | 'document',
    accessLevel: 'free'
  });

  // Mock data
  const classes = ['JSS 1A', 'JSS 1B', 'JSS 2A', 'JSS 2B', 'JSS 3A', 'SSS 1A', 'SSS 2A', 'SSS 3A'];
  const subjects = ['Mathematics', 'English Language', 'Physics', 'Chemistry', 'Biology', 'Geography'];

  const resources: Resource[] = [
    {
      id: 1,
      title: 'Quadratic Equations - Past Questions',
      type: 'pdf',
      subject: 'Mathematics',
      class: 'SSS 2A',
      uploadDate: '2023-12-10',
      size: '2.4 MB',
      downloads: 45,
      status: 'available',
      description: 'Collection of past questions on quadratic equations'
    },
    {
      id: 2,
      title: 'Photosynthesis Experiment Video',
      type: 'video',
      subject: 'Biology',
      class: 'JSS 3A',
      uploadDate: '2023-12-09',
      size: '125 MB',
      downloads: 32,
      status: 'processing',
      description: 'Step-by-step photosynthesis experiment demonstration'
    },
    {
      id: 3,
      title: 'Chemical Bonding Diagrams',
      type: 'image',
      subject: 'Chemistry',
      class: 'SSS 1A',
      uploadDate: '2023-12-08',
      size: '856 KB',
      downloads: 28,
      status: 'available',
      description: 'Visual diagrams showing different types of chemical bonds'
    },
    {
      id: 4,
      title: 'Grammar Rules Handbook',
      type: 'pdf',
      subject: 'English Language',
      class: 'JSS 2B',
      uploadDate: '2023-12-07',
      size: '1.8 MB',
      downloads: 67,
      status: 'available',
      description: 'Comprehensive guide to English grammar rules'
    }
  ];

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const file = files[0];

      // Validate file size (max 10MB for PDFs, 100MB for videos)
      const maxSize = resourceDetails.type === 'video' ? 100 * 1024 * 1024 : 10 * 1024 * 1024;
      if (file.size > maxSize) {
        setUploadStatus('error');
        return;
      }

      setIsUploading(true);
      setUploadStatus('uploading');

      // Simulate upload progress
      let progress = 0;
      const interval = setInterval(() => {
        progress += 10;
        setUploadProgress(progress);

        if (progress >= 100) {
          clearInterval(interval);
          setIsUploading(false);
          setUploadStatus('success');
          setUploadProgress(0);
        }
      }, 200);
    }
  };

  const handleBulkUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      // Handle multiple file upload logic
      console.log(`Uploading ${files.length} files`);
    }
  };

  const filteredResources = resources.filter(resource => {
    const matchesSearch = resource.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      resource.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === 'all' || resource.type === filterType;
    const matchesSubject = filterSubject === 'all' || resource.subject === filterSubject;

    return matchesSearch && matchesType && matchesSubject;
  });

  const getResourceIcon = (type: string) => {
    switch (type) {
      case 'pdf':
      case 'document':
        return <FileText className="w-4 h-4" />;
      case 'video':
        return <Video className="w-4 h-4" />;
      case 'image':
        return <Image className="w-4 h-4" />;
      default:
        return <FileText className="w-4 h-4" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available': return 'default';
      case 'processing': return 'secondary';
      case 'error': return 'destructive';
      default: return 'secondary';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'available': return <CheckCircle className="w-4 h-4" />;
      case 'processing': return <Clock className="w-4 h-4" />;
      case 'error': return <AlertCircle className="w-4 h-4" />;
      default: return <Clock className="w-4 h-4" />;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Resource Management</h1>
        <p className="text-gray-600 mt-1">Upload and manage academic resources for your students</p>
      </div>

      <Tabs value={uploadTab} onValueChange={setUploadTab}>
        <TabsList>
          <TabsTrigger value="single">Upload Resource</TabsTrigger>
          <TabsTrigger value="bulk">Bulk Upload</TabsTrigger>
          <TabsTrigger value="manage">Manage Resources</TabsTrigger>
        </TabsList>

        <TabsContent value="single" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="w-5 h-5" />
                Upload New Resource
              </CardTitle>
              <CardDescription>
                Upload PDFs, videos, images, and other educational materials for your students
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="title">Resource Title</Label>
                  <Input
                    id="title"
                    value={resourceDetails.title}
                    onChange={(e) => setResourceDetails({ ...resourceDetails, title: e.target.value })}
                    placeholder="e.g., Quadratic Equations - Past Questions"
                  />
                </div>
                <div>
                  <Label htmlFor="type">Resource Type</Label>
                  <Select value={resourceDetails.type} onValueChange={(value: any) => setResourceDetails({ ...resourceDetails, type: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pdf">PDF Document</SelectItem>
                      <SelectItem value="video">Video</SelectItem>
                      <SelectItem value="image">Image/Diagram</SelectItem>
                      <SelectItem value="document">Other Document</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="subject">Subject</Label>
                  <Select value={resourceDetails.subject} onValueChange={(value: string) => setResourceDetails({ ...resourceDetails, subject: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a subject" />
                    </SelectTrigger>
                    <SelectContent>
                      {subjects.map(subject => (
                        <SelectItem key={subject} value={subject}>{subject}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="class">Target Class</Label>
                  <Select value={resourceDetails.class} onValueChange={(value: string) => setResourceDetails({ ...resourceDetails, class: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a class" />
                    </SelectTrigger>
                    <SelectContent>
                      {classes.map(cls => (
                        <SelectItem key={cls} value={cls}>{cls}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={resourceDetails.description}
                  onChange={(e) => setResourceDetails({ ...resourceDetails, description: e.target.value })}
                  placeholder="Provide a brief description of this resource..."
                  rows={3}
                />
              </div>

              <div>
                <Label htmlFor="accessLevel">Access Level</Label>
                <Select value={resourceDetails.accessLevel} onValueChange={(value: string) => setResourceDetails({ ...resourceDetails, accessLevel: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Free Access</SelectItem>
                    <SelectItem value="paid">Paid Access</SelectItem>
                    <SelectItem value="premium">Premium Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="file">Upload File</Label>
                <div className="mt-2">
                  <input
                    type="file"
                    accept={resourceDetails.type === 'video' ? '.mp4,.avi,.mov' : resourceDetails.type === 'image' ? '.jpg,.jpeg,.png,.gif' : '.pdf,.doc,.docx'}
                    onChange={handleFileUpload}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  />
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  {resourceDetails.type === 'video'
                    ? 'Accepted formats: MP4, AVI, MOV. Maximum size: 100MB.'
                    : resourceDetails.type === 'image'
                      ? 'Accepted formats: JPG, PNG, GIF. Maximum size: 10MB.'
                      : 'Accepted formats: PDF, DOC, DOCX. Maximum size: 10MB.'
                  }
                </p>
              </div>

              {isUploading && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Uploading...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <Progress value={uploadProgress} className="h-2" />
                </div>
              )}

              {uploadStatus === 'success' && (
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    Resource uploaded successfully! It&apos;s now available for students to access.
                  </AlertDescription>
                </Alert>
              )}

              {uploadStatus === 'error' && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Upload failed. Ensure file is valid and under the size limit.
                  </AlertDescription>
                </Alert>
              )}

              <Button
                className="w-full"
                disabled={!resourceDetails.title || !resourceDetails.subject || !resourceDetails.class || isUploading}
              >
                {isUploading ? 'Uploading...' : 'Upload Resource'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bulk" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="w-5 h-5" />
                Bulk Upload
              </CardTitle>
              <CardDescription>
                Upload multiple resources at once. Ensure all files follow the naming convention: Subject_Class_Title.extension
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="bulkFiles">Select Multiple Files</Label>
                <div className="mt-2">
                  <input
                    type="file"
                    multiple
                    onChange={handleBulkUpload}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  />
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Select up to 10 files. Each file should be under 10MB for documents or 100MB for videos.
                </p>
              </div>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <div>
                    <p className="font-medium mb-2">Naming Convention:</p>
                    <ul className="text-sm space-y-1 list-disc list-inside">
                      <li>Mathematics_JSS1A_Algebra.pdf</li>
                      <li>Physics_SSS2A_Mechanics_Video.mp4</li>
                      <li>Biology_JSS3A_Photosynthesis_Diagram.png</li>
                    </ul>
                  </div>
                </AlertDescription>
              </Alert>

              <Button className="w-full">Process Bulk Upload</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manage" className="space-y-6">
          {/* Search and Filter */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <Input
                      placeholder="Search resources..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Select value={filterType} onValueChange={setFilterType}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="pdf">PDFs</SelectItem>
                      <SelectItem value="video">Videos</SelectItem>
                      <SelectItem value="image">Images</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={filterSubject} onValueChange={setFilterSubject}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Subjects</SelectItem>
                      {subjects.map(subject => (
                        <SelectItem key={subject} value={subject}>{subject}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Resources Table */}
          <Card>
            <CardHeader>
              <CardTitle>Your Resources ({filteredResources.length})</CardTitle>
              <CardDescription>
                Manage your uploaded academic resources
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Resource</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Downloads</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredResources.map((resource) => (
                    <TableRow key={resource.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{resource.title}</p>
                          <p className="text-sm text-gray-500">{resource.description}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getResourceIcon(resource.type)}
                          <span className="capitalize">{resource.type}</span>
                        </div>
                      </TableCell>
                      <TableCell>{resource.subject}</TableCell>
                      <TableCell>{resource.class}</TableCell>
                      <TableCell>{resource.size}</TableCell>
                      <TableCell>{resource.downloads}</TableCell>
                      <TableCell>
                        <Badge variant={getStatusColor(resource.status)} className="flex items-center gap-1 w-fit">
                          {getStatusIcon(resource.status)}
                          <span className="capitalize">{resource.status}</span>
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" title="Preview">
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="sm" title="Download">
                            <Download className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="sm" title="Delete">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}