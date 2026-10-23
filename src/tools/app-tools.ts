/**
 * App management tool definitions
 */
import { ToolDefinition, getPaginationProperties } from './types.js';
import * as appService from '../services/apps.js';

export function getAppTools(): ToolDefinition[] {
    return [
        {
            name: 'liara_list_apps',
            description: 'List all apps/projects in your Liara account',
            inputSchema: {
                type: 'object',
                properties: getPaginationProperties(),
            },
        },
        {
            name: 'liara_get_app',
            description: 'Get detailed information about a specific app',
            inputSchema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'The name of the app',
                    },
                },
                required: ['name'],
            },
        },
        {
            name: 'liara_create_app',
            description: 'Create an app with verified plan/bundle/network from the selected Liara account. Requires bundlePlanID when multiple bundles are available.',
            inputSchema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'App name (3-32 chars, lowercase, alphanumeric with hyphens)',
                    },
                    platform: {
                        type: 'string',
                        description: 'Platform type',
                        enum: appService.getAvailablePlatforms(),
                    },
                    planID: {
                        type: 'string',
                        description: 'Plan ID for the app',
                    },
                    bundlePlanID: {type:'string', description:'Feature bundle ID from liara_list_plans (e.g. basic). Required if selection is ambiguous.'},
                    network: {type:'string', description:'Network name or _id from liara_list_networks; resolved to _id before API call.'},
                },
                required: ['name', 'platform', 'planID'],
            },
        },
        {
            name: 'liara_delete_app',
            description: 'Delete an app',
            inputSchema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'The name of the app to delete',
                    },
                },
                required: ['name'],
            },
        },
        {
            name: 'liara_start_app',
            description: 'Start an app (scale up)',
            inputSchema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'The name of the app to start',
                    },
                },
                required: ['name'],
            },
        },
        {
            name: 'liara_stop_app',
            description: 'Stop an app (scale down)',
            inputSchema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'The name of the app to stop',
                    },
                },
                required: ['name'],
            },
        },
        {
            name: 'liara_restart_app',
            description: 'Restart a specific app in configured team/account; omit name only if exactly one app is visible. The operation changes cloud runtime.',
            inputSchema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'The name of the app to restart',
                    },
                },
            },
        },
        {
            name: 'liara_resize_app',
            description: 'Change app plan (resize resources)',
            inputSchema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'The name of the app',
                    },
                    planID: {
                        type: 'string',
                        description: 'New plan ID',
                    },
                },
                required: ['name', 'planID'],
            },
        },
    ];
}
