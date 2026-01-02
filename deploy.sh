EC2_IP="3.36.179.85"
PEM_KEY="/Users/jungbogeon/Documents/AWS-PEM/ai-translation-server.pem"
REMOTE_USER="ubuntu"

echo "📦 Syncing files to EC2..."
rsync -avz --progress \
    --exclude='.venv' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    -e "ssh -i $PEM_KEY" \
    /Users/jungbogeon/Documents/KRAFTON-JUNGLE-EUM/python-server/ \
    ${REMOTE_USER}@${EC2_IP}:~/python-server/

# echo "🔄 Restarting server on EC2..."
# ssh -i $PEM_KEY ${REMOTE_USER}@${EC2_IP} "sudo systemctl restart ai-server"

echo "✅ Deployment complete!"