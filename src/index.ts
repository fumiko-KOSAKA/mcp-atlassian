#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';

class AtlassianServer {
  private server: Server;
  private confluenceApi;
  private jiraApi;

  constructor() {
    this.server = new Server(
      {
        name: 'mcp-atlassian',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Set up Confluence API if credentials are provided
    if (process.env.CONFLUENCE_URL && process.env.CONFLUENCE_USERNAME && process.env.CONFLUENCE_API_TOKEN) {
      this.confluenceApi = axios.create({
        baseURL: process.env.CONFLUENCE_URL,
        auth: {
          username: process.env.CONFLUENCE_USERNAME,
          password: process.env.CONFLUENCE_API_TOKEN,
        },
      });
    }

    // Set up Jira API if credentials are provided
    if (process.env.JIRA_URL && process.env.JIRA_USERNAME && process.env.JIRA_API_TOKEN) {
      this.jiraApi = axios.create({
        baseURL: `${process.env.JIRA_URL}/rest/api/2`,
        auth: {
          username: process.env.JIRA_USERNAME,
          password: process.env.JIRA_API_TOKEN,
        },
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
    }

    this.setupToolHandlers();

    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        ...(this.confluenceApi ? [
          {
            name: 'confluence_search',
            description: 'Search Confluence content using CQL',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'CQL query string',
                },
                limit: {
                  type: 'number',
                  description: 'Results limit (1-50)',
                  minimum: 1,
                  maximum: 50,
                },
              },
              required: ['query'],
            },
          },
        ] : []),
        ...(this.jiraApi ? [
          {
            name: 'jira_search',
            description: 'Search Jira issues using JQL',
            inputSchema: {
              type: 'object',
              properties: {
                jql: {
                  type: 'string',
                  description: 'JQL query string',
                },
                limit: {
                  type: 'number',
                  description: 'Results limit (1-50)',
                  minimum: 1,
                  maximum: 50,
                },
              },
              required: ['jql'],
            },
          },
        ] : []),
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case 'confluence_search':
          if (!this.confluenceApi) {
            throw new McpError(ErrorCode.MethodNotFound, 'Confluence is not configured');
          }
          try {
            const { query, limit = 10 } = request.params.arguments as any;
            const response = await this.confluenceApi.get('/rest/api/content/search', {
              params: {
                cql: query,
                limit: Math.min(limit, 50),
                expand: 'space',
              },
            });
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(response.data.results, null, 2),
              }],
            };
          } catch (error: any) {
            throw new McpError(ErrorCode.InternalError, error.message);
          }

        case 'jira_search':
          if (!this.jiraApi) {
            throw new McpError(ErrorCode.MethodNotFound, 'Jira is not configured');
          }
          try {
            const { jql, limit = 10 } = request.params.arguments as any;
            const response = await this.jiraApi.get('/search', {
              params: {
                jql,
                maxResults: Math.min(limit, 50),
              },
            });
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(response.data.issues, null, 2),
              }],
            };
          } catch (error: any) {
            throw new McpError(ErrorCode.InternalError, error.message);
          }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Atlassian MCP server running on stdio');
  }
}

const server = new AtlassianServer();
server.run().catch(console.error);
