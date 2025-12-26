import { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Alert, AlertDescription } from '../ui/alert';
import { Eye, EyeOff, CheckCircle } from 'lucide-react';

interface PasswordChangeFormProps {
  onPasswordChange: (currentPassword: string, newPassword: string) => void;
  error?: string;
  isLoading?: boolean;
}

export function PasswordChangeForm({ onPasswordChange, error, isLoading }: PasswordChangeFormProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false
  });
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const validatePassword = (password: string) => {
    const errors = [];
    if (password.length < 8) errors.push('At least 8 characters long');
    if (!/[A-Z]/.test(password)) errors.push('At least one uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('At least one lowercase letter');
    if (!/\d/.test(password)) errors.push('At least one number');
    return errors;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const errors = validatePassword(newPassword);
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    
    if (newPassword !== confirmPassword) {
      setValidationErrors(['Passwords do not match']);
      return;
    }
    
    setValidationErrors([]);
    onPasswordChange(currentPassword, newPassword);
  };

  const passwordStrength = newPassword ? validatePassword(newPassword) : [];

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary rounded-full flex items-center justify-center mb-4">
            <span className="text-white font-bold">EP</span>
          </div>
          <CardTitle>Change Password</CardTitle>
          <CardDescription>
            Please change your password to continue. This is required for first-time login.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {validationErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertDescription>
                  <ul className="list-disc list-inside space-y-1">
                    {validationErrors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current Password</Label>
              <div className="relative">
                <Input
                  id="currentPassword"
                  type={showPasswords.current ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  required
                  disabled={isLoading}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowPasswords(prev => ({ ...prev, current: !prev.current }))}
                  disabled={isLoading}
                >
                  {showPasswords.current ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showPasswords.new ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  required
                  disabled={isLoading}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowPasswords(prev => ({ ...prev, new: !prev.new }))}
                  disabled={isLoading}
                >
                  {showPasswords.new ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              
              {newPassword && (
                <div className="text-sm space-y-1">
                  <p className="text-muted-foreground">Password requirements:</p>
                  {['At least 8 characters long', 'At least one uppercase letter', 'At least one lowercase letter', 'At least one number'].map((requirement, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <CheckCircle className={`h-3 w-3 ${passwordStrength.includes(requirement) ? 'text-muted-foreground' : 'text-green-500'}`} />
                      <span className={passwordStrength.includes(requirement) ? 'text-muted-foreground' : 'text-green-500'}>
                        {requirement}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showPasswords.confirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  required
                  disabled={isLoading}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowPasswords(prev => ({ ...prev, confirm: !prev.confirm }))}
                  disabled={isLoading}
                >
                  {showPasswords.confirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full" 
              disabled={isLoading || passwordStrength.length > 0}
            >
              {isLoading ? 'Changing Password...' : 'Change Password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}