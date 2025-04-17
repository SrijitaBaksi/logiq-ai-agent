const vscode = require('vscode');
const dotenv = require('dotenv');
const { exec } = require('child_process');
const { GoogleGenAI } = require('@google/genai');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');
const path = require('path');
const os = require('os');
dotenv.config({ path: path.join(__dirname, '.env') });

async function generatePlan(task) {
  const apiKey = process.env.GEMINI_API_KEY;
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: `Give me a step-by-step (one line each) terminal commands only (no suggestions or descriptions) to: ${task}`
  });

  const text = response?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("❌ No response from Gemini API");

  const plan = text
    .split('\n')
    .map(line => line.trim())
    .filter(line =>
      line &&
      !line.startsWith('```') &&
      !line.toLowerCase().startsWith('#') &&
      !line.includes('Output:') &&
      !line.startsWith('$')
    )
    .map(line => line.replace(/^\$\s*/, ''));

  return plan;
}

async function executeCommands(commands, outputChannel, cwdPath) {
  for (const command of commands) {
    outputChannel.appendLine(`\n$ ${command}`);
    try {
      const { stdout, stderr } = await execAsync(command, { cwd: cwdPath });
      if (stdout) outputChannel.appendLine(`Output: ${stdout}`);
      if (stderr) outputChannel.appendLine(`Error: ${stderr}`);
    } catch (err) {
      outputChannel.appendLine(`Execution failed: ${err}`);
      return false;
    }
  }
  return true;
}

function getDefaultDirectory() {
  const extensionDir = __dirname;
  try {
    fs.accessSync(extensionDir, fs.constants.W_OK);
    return extensionDir;
  } catch {
    return path.join(os.homedir(), 'Documents');
  }
}

function activate(context) {
  console.log("AI Agent activated");

  let disposable = vscode.commands.registerCommand('logiq-ai-agent.helloWorld', async function () {
    const outputChannel = vscode.window.createOutputChannel('AI Agent');
    outputChannel.show();

    try {
      while (true) {
        const task = await vscode.window.showInputBox({
          prompt: 'Enter a terminal task (e.g., "Set up Express app"). Type "stop" to exit.',
          ignoreFocusOut: true
        });

        if (!task || task.toLowerCase() === 'stop') {
          vscode.window.showInformationMessage('👋 Exiting AI Agent.');
          break;
        }

        const activeEditor = vscode.window.activeTextEditor;
        const activeFilePath = activeEditor ? activeEditor.document.uri.fsPath : 'No active file';
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const workspacePath = workspaceFolders && workspaceFolders.length > 0
          ? workspaceFolders[0].uri.fsPath
          : getDefaultDirectory();

        outputChannel.appendLine(`📁 Working Directory: ${workspacePath}`);
        outputChannel.appendLine(`📄 Active File: ${activeFilePath}`);
        outputChannel.appendLine(`📝 Task: ${task}`);

        let plan = await generatePlan(task);
        outputChannel.appendLine('\n📋 Plan:');
        plan.forEach((step, i) => outputChannel.appendLine(`${i + 1}. ${step}`));

        const approval = await vscode.window.showQuickPick(['Yes', 'No'], {
          placeHolder: 'Do you approve the plan?'
        });

        if (approval !== 'Yes') {
          vscode.window.showInformationMessage('❌ Plan rejected. Skipping task.');
          continue;
        }

        let success = await executeCommands(plan, outputChannel, workspacePath);

        // 🔁 Feedback loop on failure
        while (!success) {
          const reason = await vscode.window.showInputBox({
            prompt: 'Task failed. What went wrong?',
            ignoreFocusOut: true
          });

          if (!reason) {
            vscode.window.showInformationMessage('No feedback provided. Skipping task.');
            break;
          }

          const refinedTask = `${task}. Note: Last attempt failed because: ${reason}`;
          plan = await generatePlan(refinedTask);
          outputChannel.appendLine('\n🔁 New Plan:');
          plan.forEach((step, i) => outputChannel.appendLine(`${i + 1}. ${step}`));

          const retryApproval = await vscode.window.showQuickPick(['Yes', 'No'], {
            placeHolder: 'Approve the new plan?'
          });

          if (retryApproval !== 'Yes') {
            vscode.window.showInformationMessage('❌ New plan not approved. Skipping task.');
            break;
          }

          success = await executeCommands(plan, outputChannel, workspacePath);
        }

        if (success) {
          vscode.window.showInformationMessage('✅ Task completed successfully!');
        }
      }
    } catch (error) {
      vscode.window.showErrorMessage(`❌ Error: ${error.message}`);
    }
  });

  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
