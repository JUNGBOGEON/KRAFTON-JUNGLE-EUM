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
import { Switch } from '../ui/switch';
import { 
  Plus, 
  Clock, 
  Users, 
  Settings, 
  Play, 
  Pause, 
  Edit,
  Trash2,
  AlertCircle,
  CheckCircle,
  Calendar
} from 'lucide-react';

interface Question {
  id: number;
  question: string;
  options: string[];
  correctAnswer: number;
  points: number;
}

interface CBTTest {
  id: number;
  title: string;
  subject: string;
  class: string;
  duration: number;
  totalQuestions: number;
  totalPoints: number;
  status: 'draft' | 'scheduled' | 'active' | 'completed';
  scheduledDate: string;
  attemptedBy: number;
}

export function CBTManagement() {
  const [activeTab, setActiveTab] = useState('create');
  const [testDetails, setTestDetails] = useState({
    title: '',
    subject: '',
    class: '',
    duration: 60,
    instructions: '',
    shuffleQuestions: true,
    showResults: true,
    allowRetakes: false,
    scheduledDate: '',
    scheduledTime: ''
  });

  const [questions, setQuestions] = useState<Question[]>([
    {
      id: 1,
      question: '',
      options: ['', '', '', ''],
      correctAnswer: 0,
      points: 1
    }
  ]);

  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // Mock data
  const classes = ['JSS 1A', 'JSS 1B', 'JSS 2A', 'JSS 2B', 'JSS 3A', 'SSS 1A', 'SSS 2A', 'SSS 3A'];
  const subjects = ['Mathematics', 'English Language', 'Physics', 'Chemistry', 'Biology', 'Geography'];
  
  const existingTests: CBTTest[] = [
    {
      id: 1,
      title: 'Mathematics Mid-Term Test',
      subject: 'Mathematics',
      class: 'JSS 1A',
      duration: 60,
      totalQuestions: 20,
      totalPoints: 20,
      status: 'scheduled',
      scheduledDate: '2023-12-20',
      attemptedBy: 0
    },
    {
      id: 2,
      title: 'English Language Quiz',
      subject: 'English Language',
      class: 'JSS 2B',
      duration: 45,
      totalQuestions: 15,
      totalPoints: 15,
      status: 'active',
      scheduledDate: '2023-12-15',
      attemptedBy: 12
    },
    {
      id: 3,
      title: 'Physics Chapter 1 Test',
      subject: 'Physics',
      class: 'SSS 1A',
      duration: 90,
      totalQuestions: 25,
      totalPoints: 30,
      status: 'completed',
      scheduledDate: '2023-12-10',
      attemptedBy: 25
    }
  ];

  const addQuestion = () => {
    setQuestions([...questions, {
      id: Date.now(),
      question: '',
      options: ['', '', '', ''],
      correctAnswer: 0,
      points: 1
    }]);
  };

  const updateQuestion = (id: number, field: string, value: any) => {
    setQuestions(questions.map(q => 
      q.id === id ? { ...q, [field]: value } : q
    ));
  };

  const updateQuestionOption = (questionId: number, optionIndex: number, value: string) => {
    setQuestions(questions.map(q => 
      q.id === questionId 
        ? { ...q, options: q.options.map((opt, idx) => idx === optionIndex ? value : opt) }
        : q
    ));
  };

  const removeQuestion = (id: number) => {
    if (questions.length > 1) {
      setQuestions(questions.filter(q => q.id !== id));
    }
  };

  const handleSaveTest = () => {
    setShowConfirmDialog(true);
  };

  const handlePublishTest = () => {
    // Save and publish logic here
    setShowConfirmDialog(false);
    // Show success message
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'secondary';
      case 'scheduled': return 'default';
      case 'active': return 'default';
      case 'completed': return 'secondary';
      default: return 'secondary';
    }
  };

  const totalPoints = questions.reduce((sum, q) => sum + q.points, 0);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">CBT Management</h1>
        <p className="text-gray-600 mt-1">Create and schedule computer-based tests for your students</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="create">Create Test</TabsTrigger>
          <TabsTrigger value="manage">Manage Tests</TabsTrigger>
        </TabsList>

        <TabsContent value="create" className="space-y-6">
          {/* Test Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                Test Details
              </CardTitle>
              <CardDescription>
                Configure basic test information and settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="title">Test Title</Label>
                  <Input
                    id="title"
                    value={testDetails.title}
                    onChange={(e) => setTestDetails({...testDetails, title: e.target.value})}
                    placeholder="e.g., Mathematics Mid-Term Test"
                  />
                </div>
                <div>
                  <Label htmlFor="duration">Duration (minutes)</Label>
                  <Input
                    id="duration"
                    type="number"
                    min="1"
                    value={testDetails.duration}
                    onChange={(e) => setTestDetails({...testDetails, duration: parseInt(e.target.value)})}
                  />
                </div>
                <div>
                  <Label htmlFor="class">Select Class</Label>
                  <Select value={testDetails.class} onValueChange={(value) => setTestDetails({...testDetails, class: value})}>
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
                  <Select value={testDetails.subject} onValueChange={(value) => setTestDetails({...testDetails, subject: value})}>
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
                <Label htmlFor="instructions">Test Instructions</Label>
                <Textarea
                  id="instructions"
                  value={testDetails.instructions}
                  onChange={(e) => setTestDetails({...testDetails, instructions: e.target.value})}
                  placeholder="Enter instructions for students..."
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="scheduledDate">Scheduled Date</Label>
                  <Input
                    id="scheduledDate"
                    type="date"
                    value={testDetails.scheduledDate}
                    onChange={(e) => setTestDetails({...testDetails, scheduledDate: e.target.value})}
                  />
                </div>
                <div>
                  <Label htmlFor="scheduledTime">Scheduled Time</Label>
                  <Input
                    id="scheduledTime"
                    type="time"
                    value={testDetails.scheduledTime}
                    onChange={(e) => setTestDetails({...testDetails, scheduledTime: e.target.value})}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="shuffleQuestions">Shuffle Questions</Label>
                    <p className="text-sm text-gray-500">Randomize question order for each student</p>
                  </div>
                  <Switch
                    id="shuffleQuestions"
                    checked={testDetails.shuffleQuestions}
                    onCheckedChange={(checked) => setTestDetails({...testDetails, shuffleQuestions: checked})}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="showResults">Show Results Immediately</Label>
                    <p className="text-sm text-gray-500">Students see results after completion</p>
                  </div>
                  <Switch
                    id="showResults"
                    checked={testDetails.showResults}
                    onCheckedChange={(checked) => setTestDetails({...testDetails, showResults: checked})}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="allowRetakes">Allow Retakes</Label>
                    <p className="text-sm text-gray-500">Students can retake the test</p>
                  </div>
                  <Switch
                    id="allowRetakes"
                    checked={testDetails.allowRetakes}
                    onCheckedChange={(checked) => setTestDetails({...testDetails, allowRetakes: checked})}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Questions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Plus className="w-5 h-5" />
                  Questions ({questions.length})
                </div>
                <div className="text-sm text-gray-500">
                  Total Points: {totalPoints}
                </div>
              </CardTitle>
              <CardDescription>
                Add multiple-choice questions for your test
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {questions.map((question, index) => (
                <div key={question.id} className="border rounded-lg p-4 space-y-4">
                  <div className="flex justify-between items-start">
                    <h4 className="font-medium">Question {index + 1}</h4>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`points-${question.id}`} className="text-sm">Points:</Label>
                        <Input
                          id={`points-${question.id}`}
                          type="number"
                          min="1"
                          value={question.points}
                          onChange={(e) => updateQuestion(question.id, 'points', parseInt(e.target.value))}
                          className="w-16"
                        />
                      </div>
                      {questions.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeQuestion(question.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  
                  <div>
                    <Label htmlFor={`question-${question.id}`}>Question</Label>
                    <Textarea
                      id={`question-${question.id}`}
                      value={question.question}
                      onChange={(e) => updateQuestion(question.id, 'question', e.target.value)}
                      placeholder="Enter your question here..."
                      rows={2}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Answer Options</Label>
                    {question.options.map((option, optionIndex) => (
                      <div key={optionIndex} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`correct-${question.id}`}
                          checked={question.correctAnswer === optionIndex}
                          onChange={() => updateQuestion(question.id, 'correctAnswer', optionIndex)}
                          className="w-4 h-4"
                        />
                        <span className="w-6 text-sm font-medium">{String.fromCharCode(65 + optionIndex)}.</span>
                        <Input
                          value={option}
                          onChange={(e) => updateQuestionOption(question.id, optionIndex, e.target.value)}
                          placeholder={`Option ${String.fromCharCode(65 + optionIndex)}`}
                          className="flex-1"
                        />
                      </div>
                    ))}
                    <p className="text-sm text-gray-500">Select the radio button next to the correct answer</p>
                  </div>
                </div>
              ))}

              <Button onClick={addQuestion} variant="outline" className="w-full flex items-center gap-2">
                <Plus className="w-4 h-4" />
                Add Question
              </Button>
            </CardContent>
          </Card>

          {/* Save Actions */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex gap-2">
                <Button variant="outline">Save as Draft</Button>
                <Button onClick={handleSaveTest} className="flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Schedule Test
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Confirmation Dialog */}
          {showConfirmDialog && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-4">
                  <p>Do you want to make this test live? Students will be able to access it at the scheduled time.</p>
                  <div className="flex gap-2">
                    <Button onClick={handlePublishTest} size="sm">
                      Yes, Make Live
                    </Button>
                    <Button onClick={() => setShowConfirmDialog(false)} variant="outline" size="sm">
                      Cancel
                    </Button>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        <TabsContent value="manage" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5" />
                Existing Tests
              </CardTitle>
              <CardDescription>
                Manage your scheduled and active CBT tests
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Test Title</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Questions</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Attempted</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {existingTests.map((test) => (
                    <TableRow key={test.id}>
                      <TableCell className="font-medium">{test.title}</TableCell>
                      <TableCell>{test.subject}</TableCell>
                      <TableCell>{test.class}</TableCell>
                      <TableCell>{test.duration}m</TableCell>
                      <TableCell>{test.totalQuestions}</TableCell>
                      <TableCell>
                        <Badge variant={getStatusColor(test.status)}>
                          {test.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{test.attemptedBy}/{test.status === 'completed' ? '25' : '-'}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm">
                            <Edit className="w-4 h-4" />
                          </Button>
                          {test.status === 'active' && (
                            <Button variant="ghost" size="sm">
                              <Pause className="w-4 h-4" />
                            </Button>
                          )}
                          {test.status === 'scheduled' && (
                            <Button variant="ghost" size="sm">
                              <Play className="w-4 h-4" />
                            </Button>
                          )}
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