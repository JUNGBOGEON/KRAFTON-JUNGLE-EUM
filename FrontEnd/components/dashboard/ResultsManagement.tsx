import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import {
  Upload,
  Download,
  Plus,
  Trash2,
  Save,
  FileText,
  AlertCircle,
  CheckCircle,
  User,
  Eye,
  Calendar
} from 'lucide-react';

interface StudentScore {
  subject: string;
  score: string;
  grade: string;
  remark: string;
}

interface StudentResult {
  studentId: string;
  studentName: string;
  class: string;
  term: string;
  session: string;
  scores: StudentScore[];
  totalScore: number;
  averageScore: number;
  position: number;
  teacherComment: string;
  principalComment: string;
}

export function ResultsManagement() {
  const [activeTab, setActiveTab] = useState<'csv' | 'manual' | 'student'>('csv');
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [manualResults, setManualResults] = useState([
    { id: 1, studentId: '', studentName: '', score: '', grade: '' }
  ]);

  // Student-specific results state
  const [selectedStudent, setSelectedStudent] = useState('');
  const [selectedTerm, setSelectedTerm] = useState('');
  const [selectedSession, setSelectedSession] = useState('');
  const [studentScores, setStudentScores] = useState<StudentScore[]>([]);
  const [teacherComment, setTeacherComment] = useState('');
  const [showResultPreview, setShowResultPreview] = useState(false);

  // Mock data
  const classes = ['Primary 4A', 'Primary 4B', 'Primary 5A', 'Primary 5B', 'JSS 1A', 'JSS 1B', 'SSS 1A'];
  const subjects = ['Mathematics', 'English Language', 'Basic Science', 'Social Studies', 'Civic Education', 'Computer Science', 'Creative Arts', 'Physical Education'];
  const terms = ['First Term', 'Second Term', 'Third Term'];
  const sessions = ['2023/2024', '2024/2025'];

  // Mock students for Primary 4A
  const students = [
    { id: 'P4A001', name: 'Adebayo Tunde', class: 'Primary 4A' },
    { id: 'P4A002', name: 'Chioma Okafor', class: 'Primary 4A' },
    { id: 'P4A003', name: 'Ibrahim Musa', class: 'Primary 4A' },
    { id: 'P4A004', name: 'Fatima Aliyu', class: 'Primary 4A' },
    { id: 'P4A005', name: 'Emeka Okwu', class: 'Primary 4A' },
  ];

  const recentResults = [
    { class: 'Primary 4A', subject: 'Mathematics', students: 32, uploadDate: '2023-12-10', status: 'published' },
    { class: 'Primary 4B', subject: 'English Language', students: 28, uploadDate: '2023-12-09', status: 'draft' },
    { class: 'Primary 5A', subject: 'Basic Science', students: 25, uploadDate: '2023-12-08', status: 'published' },
  ];

  // Initialize student scores when student is selected
  const initializeStudentScores = (studentId: string) => {
    if (!studentId) return;

    const initialScores = subjects.map(subject => ({
      subject,
      score: '',
      grade: '',
      remark: ''
    }));

    setStudentScores(initialScores);
    setTeacherComment('');
    setShowResultPreview(false);
  };

  const calculateGrade = (score: string) => {
    const num = parseInt(score);
    if (isNaN(num)) return '';
    if (num >= 80) return 'A';
    if (num >= 70) return 'B';
    if (num >= 60) return 'C';
    if (num >= 50) return 'D';
    if (num >= 40) return 'E';
    return 'F';
  };

  const getGradeRemark = (score: string) => {
    const num = parseInt(score);
    if (isNaN(num)) return '';
    if (num >= 80) return 'Excellent';
    if (num >= 70) return 'Very Good';
    if (num >= 60) return 'Good';
    if (num >= 50) return 'Fair';
    if (num >= 40) return 'Pass';
    return 'Fail';
  };

  const updateStudentScore = (subject: string, field: keyof StudentScore, value: string) => {
    setStudentScores(prev => prev.map(score => {
      if (score.subject === subject) {
        const updated = { ...score, [field]: value };
        if (field === 'score') {
          updated.grade = calculateGrade(value);
          updated.remark = getGradeRemark(value);
        }
        return updated;
      }
      return score;
    }));
  };

  const calculateStudentSummary = () => {
    const validScores = studentScores.filter(s => s.score && !isNaN(parseInt(s.score)));
    const totalScore = validScores.reduce((sum, s) => sum + parseInt(s.score), 0);
    const averageScore = validScores.length > 0 ? totalScore / validScores.length : 0;

    return {
      totalScore,
      averageScore: Math.round(averageScore * 100) / 100,
      totalSubjects: validScores.length
    };
  };

  const handleSaveStudentResult = () => {
    if (!selectedStudent || !selectedClass || !selectedTerm || !selectedSession) {
      alert('Please fill in all required fields');
      return;
    }

    const validScores = studentScores.filter(s => s.score && !isNaN(parseInt(s.score)));
    if (validScores.length === 0) {
      alert('Please enter at least one subject score');
      return;
    }

    // Save logic here
    setUploadStatus('success');
    setTimeout(() => setUploadStatus('idle'), 3000);
  };

  const generateResultPreview = () => {
    const selectedStudentData = students.find(s => s.id === selectedStudent);
    const summary = calculateStudentSummary();

    return {
      studentId: selectedStudent,
      studentName: selectedStudentData?.name || '',
      class: selectedClass,
      term: selectedTerm,
      session: selectedSession,
      scores: studentScores.filter(s => s.score && !isNaN(parseInt(s.score))),
      ...summary,
      position: 5, // Mock position
      teacherComment,
      principalComment: 'Keep up the good work!'
    };
  };

  // CSV upload logic (existing)
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
        setUploadStatus('error');
        return;
      }
      setCsvFile(file);
      setUploadStatus('idle');
    }
  };

  const handleCsvUpload = async () => {
    if (!csvFile || !selectedClass || !selectedSubject) return;

    setUploadStatus('uploading');

    setTimeout(() => {
      setUploadStatus('success');
      setCsvFile(null);
    }, 2000);
  };

  // Manual entry logic (existing)
  const addManualResult = () => {
    setManualResults([...manualResults, {
      id: Date.now(),
      studentId: '',
      studentName: '',
      score: '',
      grade: ''
    }]);
  };

  const removeManualResult = (id: number) => {
    setManualResults(manualResults.filter(result => result.id !== id));
  };

  const updateManualResult = (id: number, field: string, value: string) => {
    setManualResults(manualResults.map(result =>
      result.id === id ? { ...result, [field]: value } : result
    ));
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Results Management</h1>
        <p className="text-gray-600 mt-1">Upload student results by class and subject</p>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'csv' | 'manual' | 'student')}>
        <TabsList>
          <TabsTrigger value="csv">CSV Upload</TabsTrigger>
          <TabsTrigger value="manual">Manual Entry</TabsTrigger>
          <TabsTrigger value="student">Student Results</TabsTrigger>
        </TabsList>

        <TabsContent value="csv" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="w-5 h-5" />
                Upload Results via CSV
              </CardTitle>
              <CardDescription>
                Upload student results using a CSV file. Ensure your file includes columns: Student ID, Student Name, Score.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="class">Select Class</Label>
                  <Select value={selectedClass} onValueChange={setSelectedClass}>
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
                <div>
                  <Label htmlFor="subject">Select Subject</Label>
                  <Select value={selectedSubject} onValueChange={setSelectedSubject}>
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
              </div>

              <div>
                <Label htmlFor="csvFile">Upload CSV File</Label>
                <div className="mt-2">
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  />
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Accepted format: CSV files only. Maximum file size: 10MB.
                </p>
              </div>

              {csvFile && (
                <Alert>
                  <FileText className="h-4 w-4" />
                  <AlertDescription>
                    File ready: {csvFile.name} ({(csvFile.size / 1024).toFixed(1)} KB)
                  </AlertDescription>
                </Alert>
              )}

              {uploadStatus === 'error' && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Upload failed. Ensure file is a valid CSV and under 10MB.
                  </AlertDescription>
                </Alert>
              )}

              {uploadStatus === 'success' && (
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    Results uploaded successfully! Students have been notified.
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={handleCsvUpload}
                  disabled={!csvFile || !selectedClass || !selectedSubject || uploadStatus === 'uploading'}
                  className="flex items-center gap-2"
                >
                  {uploadStatus === 'uploading' ? (
                    <>Uploading...</>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Upload Results
                    </>
                  )}
                </Button>
                <Button variant="outline" className="flex items-center gap-2">
                  <Download className="w-4 h-4" />
                  Download Template
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manual" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="w-5 h-5" />
                Manual Entry
              </CardTitle>
              <CardDescription>
                Enter student results manually. Grades will be calculated automatically based on scores.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="class">Select Class</Label>
                  <Select value={selectedClass} onValueChange={setSelectedClass}>
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
                <div>
                  <Label htmlFor="subject">Select Subject</Label>
                  <Select value={selectedSubject} onValueChange={setSelectedSubject}>
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
              </div>

              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student ID</TableHead>
                      <TableHead>Student Name</TableHead>
                      <TableHead>Score (0-100)</TableHead>
                      <TableHead>Grade</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {manualResults.map((result) => (
                      <TableRow key={result.id}>
                        <TableCell>
                          <Input
                            value={result.studentId}
                            onChange={(e) => updateManualResult(result.id, 'studentId', e.target.value)}
                            placeholder="e.g., P4A001"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={result.studentName}
                            onChange={(e) => updateManualResult(result.id, 'studentName', e.target.value)}
                            placeholder="Student full name"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            value={result.score}
                            onChange={(e) => {
                              updateManualResult(result.id, 'score', e.target.value);
                              updateManualResult(result.id, 'grade', calculateGrade(e.target.value));
                            }}
                            placeholder="0-100"
                          />
                        </TableCell>
                        <TableCell>
                          <Badge variant={result.score && parseInt(result.score) >= 50 ? 'default' : 'destructive'}>
                            {result.score ? calculateGrade(result.score) : '-'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeManualResult(result.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex gap-2">
                <Button onClick={addManualResult} variant="outline" className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Add Student
                </Button>
                <Button
                  className="flex items-center gap-2"
                  disabled={!selectedClass || !selectedSubject}
                >
                  <Save className="w-4 h-4" />
                  Save Results
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="student" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5" />
                Individual Student Results
              </CardTitle>
              <CardDescription>
                Input complete results for a specific student across all subjects. Perfect for class teachers managing their students&apos; comprehensive results.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <Label htmlFor="studentClass">Select Class</Label>
                  <Select
                    value={selectedClass}
                    onValueChange={(value) => {
                      setSelectedClass(value);
                      setSelectedStudent('');
                      setStudentScores([]);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose your class" />
                    </SelectTrigger>
                    <SelectContent>
                      {classes.map(cls => (
                        <SelectItem key={cls} value={cls}>{cls}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="student">Select Student</Label>
                  <Select
                    value={selectedStudent}
                    onValueChange={(value) => {
                      setSelectedStudent(value);
                      initializeStudentScores(value);
                    }}
                    disabled={!selectedClass}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a student" />
                    </SelectTrigger>
                    <SelectContent>
                      {students.map(student => (
                        <SelectItem key={student.id} value={student.id}>
                          {student.name} ({student.id})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="term">Select Term</Label>
                  <Select value={selectedTerm} onValueChange={setSelectedTerm}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose term" />
                    </SelectTrigger>
                    <SelectContent>
                      {terms.map(term => (
                        <SelectItem key={term} value={term}>{term}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="session">Academic Session</Label>
                  <Select value={selectedSession} onValueChange={setSelectedSession}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose session" />
                    </SelectTrigger>
                    <SelectContent>
                      {sessions.map(session => (
                        <SelectItem key={session} value={session}>{session}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {selectedStudent && studentScores.length > 0 && (
                <>
                  <div className="border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Subject</TableHead>
                          <TableHead>Score (0-100)</TableHead>
                          <TableHead>Grade</TableHead>
                          <TableHead>Remark</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {studentScores.map((score, index) => (
                          <TableRow key={index}>
                            <TableCell className="font-medium">{score.subject}</TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min="0"
                                max="100"
                                value={score.score}
                                onChange={(e) => updateStudentScore(score.subject, 'score', e.target.value)}
                                placeholder="0-100"
                                className="w-20"
                              />
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={score.score && parseInt(score.score) >= 50 ? 'default' : 'destructive'}
                                className="w-8 justify-center"
                              >
                                {score.grade || '-'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm text-gray-600">{score.remark}</span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div>
                    <Label htmlFor="teacherComment">Teacher&apos;s Comment</Label>
                    <Input
                      id="teacherComment"
                      value={teacherComment}
                      onChange={(e) => setTeacherComment(e.target.value)}
                      placeholder="Enter your comment about the student's performance..."
                    />
                  </div>

                  {studentScores.some(s => s.score) && (
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <h4 className="font-medium mb-2">Result Summary</h4>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="text-gray-600">Total Score:</span>
                          <span className="ml-2 font-medium">{calculateStudentSummary().totalScore}</span>
                        </div>
                        <div>
                          <span className="text-gray-600">Average:</span>
                          <span className="ml-2 font-medium">{calculateStudentSummary().averageScore}%</span>
                        </div>
                        <div>
                          <span className="text-gray-600">Subjects:</span>
                          <span className="ml-2 font-medium">{calculateStudentSummary().totalSubjects}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      onClick={handleSaveStudentResult}
                      className="flex items-center gap-2"
                      disabled={!selectedTerm || !selectedSession || !studentScores.some(s => s.score)}
                    >
                      <Save className="w-4 h-4" />
                      Save Student Result
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setShowResultPreview(true)}
                      className="flex items-center gap-2"
                      disabled={!studentScores.some(s => s.score)}
                    >
                      <Eye className="w-4 h-4" />
                      Preview Result Card
                    </Button>
                  </div>

                  {uploadStatus === 'success' && (
                    <Alert>
                      <CheckCircle className="h-4 w-4" />
                      <AlertDescription>
                        Student result saved successfully! The student can now view their complete result card.
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Result Preview Modal */}
          {showResultPreview && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Student Result Card Preview</span>
                  <Button variant="ghost" size="sm" onClick={() => setShowResultPreview(false)}>
                    ×
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(() => {
                  const preview = generateResultPreview();
                  return (
                    <div className="bg-white border-2 border-gray-200 p-6 rounded-lg space-y-4">
                      <div className="text-center border-b pb-4">
                        <h3 className="font-bold text-lg">STUDENT RESULT CARD</h3>
                        <p className="text-sm text-gray-600">{preview.session} Academic Session - {preview.term}</p>
                      </div>

                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div><strong>Name:</strong> {preview.studentName}</div>
                        <div><strong>Student ID:</strong> {preview.studentId}</div>
                        <div><strong>Class:</strong> {preview.class}</div>
                        <div><strong>Position:</strong> {preview.position}</div>
                      </div>

                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Subject</TableHead>
                            <TableHead>Score</TableHead>
                            <TableHead>Grade</TableHead>
                            <TableHead>Remark</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {preview.scores.map((score, index) => (
                            <TableRow key={index}>
                              <TableCell>{score.subject}</TableCell>
                              <TableCell>{score.score}</TableCell>
                              <TableCell>
                                <Badge variant={parseInt(score.score) >= 50 ? 'default' : 'destructive'}>
                                  {score.grade}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm">{score.remark}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>

                      <div className="border-t pt-4 space-y-2">
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div><strong>Total Score:</strong> {preview.totalScore}</div>
                          <div><strong>Average:</strong> {preview.averageScore}%</div>
                          <div><strong>No. of Subjects:</strong> {preview.totalSubjects}</div>
                        </div>
                      </div>

                      <div className="space-y-2 text-sm">
                        <div><strong>Class Teacher&apos;s Comment:</strong> {preview.teacherComment || 'No comment provided'}</div>
                        <div><strong>Principal&apos;s Comment:</strong> {preview.principalComment}</div>
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Recent Results */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Results</CardTitle>
          <CardDescription>Previously uploaded results for your classes</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Class</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Students</TableHead>
                <TableHead>Upload Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentResults.map((result, index) => (
                <TableRow key={index}>
                  <TableCell>{result.class}</TableCell>
                  <TableCell>{result.subject}</TableCell>
                  <TableCell>{result.students}</TableCell>
                  <TableCell>{result.uploadDate}</TableCell>
                  <TableCell>
                    <Badge variant={result.status === 'published' ? 'default' : 'secondary'}>
                      {result.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm">View</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}